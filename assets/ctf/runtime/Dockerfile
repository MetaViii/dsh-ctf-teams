FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3
ARG DEBIAN_FRONTEND=noninteractive
LABEL org.opencontainers.image.source="https://github.com/MetaViii/dsh-ctf-teams" \
      io.ctf-teams.toolkit="0.1.36" io.ctf-teams.runtime="1"
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8 PYTHONUNBUFFERED=1
RUN rm -f /etc/apt/apt.conf.d/docker-clean && printf 'Acquire::Retries "5";\nBinary::apt::APT::Keep-Downloaded-Packages "true";\n' > /etc/apt/apt.conf.d/ctf-downloads
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl wget git jq ripgrep file xxd coreutils findutils procps \
    python3 python3-pip python3-venv python3-dev build-essential cmake pkg-config \
    libgmp-dev libmpfr-dev libmpc-dev libffi-dev libssl-dev libpcap-dev \
    gdb gdb-multiarch binutils patchelf strace ltrace qemu-user gcc-multilib \
    nmap sqlmap ffuf gobuster hydra john hashcat netcat-openbsd socat \
    openssh-client sshpass dnsutils iputils-ping tcpdump tshark \
    p7zip-full unrar-free unzip zip binwalk foremost exiftool steghide sleuthkit pngcheck \
    tesseract-ocr tesseract-ocr-eng zbar-tools libzbar0 ffmpeg sox \
    default-jdk-headless mono-utils ruby ruby-dev sagemath
RUN python3 -m venv --system-site-packages /opt/ctf-venv
ENV PATH=/opt/ctf-venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
COPY runtime/requirements.lock /opt/ctf-requirements.lock
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --requirement /opt/ctf-requirements.lock && pip check && pip freeze > /opt/ctf-python-freeze.txt
RUN gem install --no-document one_gadget seccomp-tools zsteg
RUN mkdir -p /opt/ctf-downloads /opt/jadx && \
    curl --fail --location --retry 3 https://github.com/upx/upx/releases/download/v5.2.1/upx-5.2.1-amd64_linux.tar.xz -o /opt/ctf-downloads/upx.tar.xz && \
    echo '402162aad30af47e60dbd767fb2e64ca394ace9727ba1f40283641f1d1b91657  /opt/ctf-downloads/upx.tar.xz' | sha256sum -c - && \
    tar -xJf /opt/ctf-downloads/upx.tar.xz -C /opt/ctf-downloads && cp /opt/ctf-downloads/upx-5.2.1-amd64_linux/upx /usr/local/bin/upx && \
    curl --fail --location --retry 3 https://github.com/skylot/jadx/releases/download/v1.5.6/jadx-1.5.6.zip -o /opt/ctf-downloads/jadx.zip && \
    echo '545ea2be9c242511bc145755cf4bda2485ade42966e096f8b4d3da2a230e8974  /opt/ctf-downloads/jadx.zip' | sha256sum -c - && \
    unzip -q /opt/ctf-downloads/jadx.zip -d /opt/jadx && chmod +x /opt/jadx/bin/jadx && ln -s /opt/jadx/bin/jadx /usr/local/bin/jadx && \
    curl --fail --location --retry 3 https://github.com/projectdiscovery/nuclei/releases/download/v3.11.1/nuclei_3.11.1_linux_amd64.zip -o /opt/ctf-downloads/nuclei.zip && \
    echo 'ea63d4ae232808cd7c6bc00d0142428e231fab59dae01042246097d195835ab6  /opt/ctf-downloads/nuclei.zip' | sha256sum -c - && \
    unzip -q /opt/ctf-downloads/nuclei.zip nuclei -d /usr/local/bin && \
    git clone --depth 1 --branch 2.6.1 https://github.com/sullo/nikto.git /opt/nikto && \
    test "$(git -C /opt/nikto rev-parse HEAD)" = d201dac320fc5187eac75e723dd07a716196ec5a && \
    printf '#!/bin/sh\nexec perl /opt/nikto/program/nikto.pl "$@"\n' > /usr/local/bin/nikto && chmod +x /usr/local/bin/nikto && \
    rm -rf /opt/ctf-downloads /opt/nikto/.git
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends php-cli php-curl php-mbstring php-xml sqlite3 apktool \
    libxml-writer-perl libxml-libxml-perl libjson-perl libio-socket-ssl-perl libnet-ssleay-perl
COPY --from=node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 /usr/local/bin/node /usr/local/bin/node
COPY --from=node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY runtime/job.py /opt/ctf-teams/job.py
COPY image_to_text.py /opt/ctf-teams/image_to_text.py
RUN mkdir -p /var/lib/ctf-teams/jobs /work && chmod 700 /var/lib/ctf-teams
WORKDIR /work
CMD ["sleep", "infinity"]
