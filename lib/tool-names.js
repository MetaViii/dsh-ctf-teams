/** Stable business API names; exposure changes never rename these operations. */
export const TEAM_TOOL_NAMES = [
    'ctf_teams_create', 'ctf_teams_approve', 'ctf_teams_edit_plan',
    'ctf_teams_add_member', 'ctf_teams_remove_member', 'ctf_teams_create_task',
    'ctf_teams_reassign_task', 'ctf_teams_claim_task', 'ctf_teams_update_task',
    'ctf_teams_amend_task',
    'ctf_teams_set_challenge', 'ctf_teams_submit_flag', 'ctf_teams_mark_flag',
    'ctf_teams_report_finding', 'ctf_teams_sync', 'ctf_teams_knowledge',
    'ctf_teams_env', 'ctf_teams_references',
    'ctf_teams_send_message', 'ctf_teams_status', 'ctf_teams_resume', 'ctf_teams_delete',
];
export const MEMBER_TOOL_NAMES = [
    'ctf_teams_claim_task', 'ctf_teams_update_task', 'ctf_teams_send_message', 'ctf_teams_status',
    'ctf_teams_submit_flag', 'ctf_teams_report_finding', 'ctf_teams_sync', 'ctf_teams_knowledge',
    'ctf_teams_env', 'ctf_teams_references',
];
export const CAPTAIN_TOOL_NAMES = TEAM_TOOL_NAMES.filter(name => !MEMBER_TOOL_NAMES.includes(name));
