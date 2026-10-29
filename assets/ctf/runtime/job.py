#!/usr/bin/env python3
"""Container-owned job supervisor. Control files never enter the writable workspace."""
import argparse
import fcntl
import grp
import json
import os
import pwd
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT = Path('/var/lib/ctf-teams/jobs')


def folder(job):
    if len(job) != 36 or any(c not in '0123456789abcdef-' for c in job):
        raise ValueError('invalid job id')
    return ROOT / job


def save(p, value):
    temp = p.with_suffix('.tmp')
    temp.write_text(json.dumps(value), encoding='utf-8')
    temp.replace(p)


def stop_group(pid):
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    time.sleep(0.15)
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def ensure_identity(uid, gid):
    if uid <= 0 or gid <= 0:
        raise ValueError('working commands must use a non-root identity')
    with (ROOT/'.identity.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            grp.getgrgid(gid)
        except KeyError:
            with open('/etc/group', 'a') as groups:
                groups.write(f'ctf{gid}:x:{gid}:\n')
        try:
            pwd.getpwuid(uid)
        except KeyError:
            with open('/etc/passwd', 'a') as users:
                users.write(f'ctf{uid}:x:{uid}:{gid}:CTF Worker:/tmp/ctf-home:/bin/bash\n')


def supervise(job, command, cwd, timeout):
    base = folder(job)
    payload = json.loads((base/'payload.json').read_text())
    command, cwd, timeout = payload['command'], payload['cwd'], payload['timeout']
    state = dict(id=job, status='starting', started_at=int(time.time()*1000), exit_code=None)
    save(base/'state.json', state)
    uid, gid = int(os.environ.get('CTF_UID', '1000')), int(os.environ.get('CTF_GID', '1000'))
    ensure_identity(uid, gid)
    def identity():
        os.setgroups([])
        os.setgid(gid)
        os.setuid(uid)
    env = dict(os.environ, HOME='/tmp/ctf-home', USER=pwd.getpwuid(uid).pw_name,
               LOGNAME=pwd.getpwuid(uid).pw_name, PYTHONUNBUFFERED='1', TERM='dumb')
    Path(env['HOME']).mkdir(exist_ok=True)
    os.chown(env['HOME'], uid, gid)
    with (base/'stdout.log').open('wb') as out, (base/'stderr.log').open('wb') as err:
        proc = subprocess.Popen(['/bin/bash', '--noprofile', '--norc', '-c', command],
                                cwd=cwd, env=env, stdout=out, stderr=err,
                                start_new_session=True, preexec_fn=identity)
        state.update(status='running', pid=proc.pid)
        save(base/'state.json', state)
        def cancel(_sig, _frame):
            (base/'cancel').touch()
        signal.signal(signal.SIGTERM, cancel)
        signal.signal(signal.SIGINT, cancel)
        deadline = time.monotonic() + timeout
        while proc.poll() is None:
            if (base/'cancel').exists():
                state['status'] = 'cancelled'
                stop_group(proc.pid)
                break
            if time.monotonic() >= deadline:
                state['status'] = 'timed_out'
                stop_group(proc.pid)
                break
            time.sleep(.05)
        code = proc.wait()
        if state['status'] == 'running':
            state['status'] = 'completed'
        # A shell may leave a background listener in its process group. Each
        # durable job owns its group; long-lived services must be background jobs.
        stop_group(proc.pid)
        state.update(exit_code=code, ended_at=int(time.time()*1000))
        save(base/'state.json', state)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['identity', 'start', 'supervise', 'status', 'cancel'])
    parser.add_argument('id', nargs='?')
    parser.add_argument('command', nargs='?', default='')
    parser.add_argument('cwd', nargs='?', default='/work')
    parser.add_argument('timeout', nargs='?', type=float, default=300)
    args = parser.parse_args()
    if args.action == 'identity':
        uid, gid = int(os.environ.get('CTF_UID', '1000')), int(os.environ.get('CTF_GID', '1000'))
        ensure_identity(uid, gid)
        print(json.dumps(dict(uid=uid, gid=gid)))
        return
    base = folder(args.id)
    if args.action == 'supervise':
        try:
            supervise(args.id, args.command, args.cwd, args.timeout)
        except Exception as exc:
            base.mkdir(parents=True, exist_ok=True, mode=0o700)
            save(base/'state.json', dict(id=args.id, status='failed', exit_code=None,
                                        ended_at=int(time.time()*1000)))
            with (base/'stderr.log').open('ab') as log:
                log.write(str(exc).encode('utf-8'))
        return
    if args.action == 'start':
        ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
        base.mkdir(exist_ok=False, mode=0o700)
        payload = json.load(sys.stdin)
        if not isinstance(payload.get('command'), str) or not isinstance(payload.get('cwd'), str):
            raise ValueError('invalid job payload')
        save(base/'payload.json', payload)
        subprocess.Popen([sys.executable, __file__, 'supervise', args.id],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True, close_fds=True)
        for _ in range(200):
            if (base/'state.json').exists():
                break
            time.sleep(.01)
    if not (base/'state.json').exists():
        raise ValueError('job did not start or no longer exists')
    state = json.loads((base/'state.json').read_text())
    if args.action == 'cancel' and state['status'] in ['starting', 'running']:
        (base/'cancel').touch()
        for _ in range(100):
            time.sleep(.02)
            state = json.loads((base/'state.json').read_text())
            if state['status'] not in ['starting', 'running']:
                break
    for stream in ['stdout', 'stderr']:
        p = base/(stream+'.log')
        size = p.stat().st_size if p.exists() else 0
        with p.open('rb') if p.exists() else open(os.devnull, 'rb') as f:
            f.seek(max(0, size-16000))
            state[stream] = f.read().decode('utf-8', errors='replace')
        state[stream+'_bytes'] = size
    print(json.dumps(state))


if __name__ == '__main__':
    main()
