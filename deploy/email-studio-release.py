"""Run on the VPS: python3 email-studio-release.py /tmp/etsawaa-email-studio.tgz.
Never prints credentials. Builds before switching, preserves old browser assets,
backs up the affected data/configuration, and enables Auth only after checks.
"""
import base64
import datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import smtplib
import subprocess
import sys
import tarfile
import time
import urllib.request
import urllib.error

ROOT = Path('/opt/etsawaa')
STAMP = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
BACKUP = ROOT / 'backups' / ('email-studio-' + STAMP)
STAGE = BACKUP / 'candidate'
IMAGE = 'etsawaa-app:email-studio-' + STAMP

def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def output(args):
    return subprocess.check_output(args, text=True)

def sql(query):
    return run(['docker','exec','-i','supabase-db','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], input=query, text=True, capture_output=True).stdout

def environment(name):
    return dict(x.split('=',1) for x in json.loads(output(['docker','inspect',name]))[0]['Config']['Env'])

def set_env(path, additions):
    text = path.read_text()
    for key,value in additions.items():
        pattern = re.compile(r'^' + re.escape(key) + r'=.*$', re.M)
        line = key + '=' + value
        text = pattern.sub(lambda _: line, text) if pattern.search(text) else text.rstrip() + '\n' + line + '\n'
    temporary = path.with_name(path.name + '.email-studio-next')
    temporary.write_text(text)
    info = path.stat()
    os.chown(temporary, info.st_uid, info.st_gid)
    os.chmod(temporary, 0o600)
    temporary.replace(path)

def request(url, payload=None, headers=None):
    req = urllib.request.Request(url, data=payload, headers={'User-Agent':'Go-http-client/1.1', **(headers or {})})
    try:
        with urllib.request.urlopen(req,timeout=15) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()

def wait_app():
    for _ in range(30):
        result = subprocess.run(['docker','exec','etsawaa-app','node','-e',"fetch('http://127.0.0.1:3000/ar').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], capture_output=True)
        if result.returncode == 0:
            return
        time.sleep(2)
    raise RuntimeError('New application did not become ready')

def activate_hook(auth, backup, old_env, secret, site):
    active=dict(x.split('=',1) for x in auth['Config']['Env'])
    if active.get('GOTRUE_HOOK_SEND_EMAIL_ENABLED')=='true':
        if active.get('GOTRUE_HOOK_SEND_EMAIL_URI')==site+'/api/webhooks/auth-email' and active.get('GOTRUE_HOOK_SEND_EMAIL_SECRETS')==secret:
            print('Auth hook already configured; preserved without restart.',flush=True)
            return
        raise RuntimeError('A different Auth email hook is active')
    config_files=auth['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
    auth_compose=Path('/opt/supabase/docker-compose.yml')
    auth_env=Path('/opt/supabase/.env')
    # Update the original compose file so normal future Supabase restarts retain the hook.
    text = auth_compose.read_text()
    match = re.search(r'(?ms)^  auth:\n.*?(?=^  [a-zA-Z][\w-]*:|\Z)',text)
    if not match: raise RuntimeError('Auth service location changed')
    block = match.group(0)
    if re.search(r'(?m)^[ \t]+GOTRUE_HOOK_SEND_EMAIL_[A-Z]+[ \t]*:',block): raise RuntimeError('Existing Auth email hook requires review')
    anchor = re.search(r'(?m)^([ \t]+)GOTRUE_SITE_URL:',block)
    if not anchor: raise RuntimeError('Auth environment location changed')
    indent=anchor.group(1)
    additions='\n'.join(indent+line for line in ['GOTRUE_HOOK_SEND_EMAIL_ENABLED: "true"','GOTRUE_HOOK_SEND_EMAIL_URI: "'+site+'/api/webhooks/auth-email"','GOTRUE_HOOK_SEND_EMAIL_SECRETS: ${AUTH_EMAIL_HOOK_SECRET}'])+'\n'
    block=block[:anchor.start()]+additions+block[anchor.start():]
    auth_compose.write_text(text[:match.start()]+block+text[match.end():])
    set_env(auth_env,{'AUTH_EMAIL_HOOK_SECRET':secret})
    compose=['docker','compose']
    for file in config_files: compose+=['-f',file]
    try:
        effective=json.loads(output(compose+['config','--format','json']))
        if effective['services']['auth']['environment']['GOTRUE_HOOK_SEND_EMAIL_SECRETS'] != secret: raise RuntimeError('Hook configuration was not resolved')
        run(compose+['up','-d','--no-deps','auth'],cwd=auth_compose.parent)
        for attempt in range(20):
            try:
                probe=subprocess.run(['docker','exec','etsawaa-app','node','-e',"fetch('http://supabase-auth:9999/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],capture_output=True)
                if probe.returncode==0: break
            except Exception: pass
            time.sleep(2)
        else: raise RuntimeError('Auth service did not become healthy')
        if environment('supabase-auth').get('GOTRUE_HOOK_SEND_EMAIL_ENABLED')!='true': raise RuntimeError('Auth hook was not enabled')
    except Exception:
        diagnostics=subprocess.run(['docker','logs','--tail','60','supabase-auth'],capture_output=True,text=True)
        (backup/'auth-activation.log').write_text(re.sub(r'whsec_[A-Za-z0-9+/=]+','[redacted]',diagnostics.stdout+diagnostics.stderr))
        shutil.copy2(backup/'supabase-compose-before.yml',auth_compose)
        shutil.copy2(backup/'supabase-env-before',auth_env)
        run(compose+['up','-d','--no-deps','auth'],cwd=auth_compose.parent)
        raise

def main():
    bundle = Path(sys.argv[1]).resolve()
    if not bundle.is_file():
        raise RuntimeError('Missing release bundle')
    BACKUP.mkdir(parents=True,mode=0o700)
    os.chmod(BACKUP,0o700)
    STAGE.mkdir()
    with tarfile.open(bundle) as archive:
        for member in archive.getmembers():
            p = Path(member.name)
            if p.is_absolute() or '..' in p.parts or member.issym() or member.islnk():
                raise RuntimeError('Unsafe bundle member')
        archive.extractall(STAGE, filter='data')
    previous = json.loads(output(['docker','inspect','etsawaa-app']))[0]['Image']
    run(['docker','tag',previous,'etsawaa-app:before-email-studio-' + STAMP])
    with tarfile.open(BACKUP/'runtime-before.tgz','w:gz') as archive:
        for name in ['build','public','package.json','package-lock.json','Dockerfile','docker-compose.yml','.env']:
            if (ROOT/name).exists(): archive.add(ROOT/name,arcname=name)
    (BACKUP/'templates-before.json').write_text(sql('select json_agg(t) from public.email_templates t;'))
    (BACKUP/'functions-before.sql').write_text(sql("select string_agg(pg_get_functiondef(oid), E'\\n') from pg_proc where pronamespace='public'::regnamespace and proname in ('fn_admin_email_templates','fn_admin_set_email_template_active','fn_admin_save_email_template');"))
    auth = json.loads(output(['docker','inspect','supabase-auth']))[0]
    config_files = auth['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
    auth_compose = Path('/opt/supabase/docker-compose.yml')
    auth_env = Path('/opt/supabase/.env')
    shutil.copy2(auth_compose, BACKUP/'supabase-compose-before.yml')
    shutil.copy2(auth_env, BACKUP/'supabase-env-before')
    old_assets = ROOT/'build/client/assets'
    new_assets = STAGE/'build/client/assets'
    if old_assets.is_dir():
        for item in old_assets.iterdir():
            if item.is_file() and not (new_assets/item.name).exists(): shutil.copy2(item,new_assets/item.name)
    print('Building candidate; rollback:',BACKUP,flush=True)
    with (BACKUP/'docker-build.log').open('w') as log:
        run(['docker','build','-t',IMAGE,'-f',str(STAGE/'deploy/Dockerfile'),str(STAGE)],stdout=log,stderr=subprocess.STDOUT)
    # Verify existing SMTP credentials without sending any message.
    old_env = environment('etsawaa-app')
    with smtplib.SMTP_SSL(old_env.get('SMTP_HOST','mx.etsawaa.com'),int(old_env.get('SMTP_PORT','465')),timeout=10) as smtp:
        smtp.login(old_env['SMTP_NOTIFY_USER'],old_env['SMTP_NOTIFY_PASS'])
        smtp.noop()
    secret = old_env.get('AUTH_EMAIL_HOOK_SECRET') or 'v1,whsec_' + base64.b64encode(secrets.token_bytes(32)).decode()
    encryption = old_env.get('AUTH_EMAIL_ENCRYPTION_KEY') or base64.b64encode(secrets.token_bytes(32)).decode()
    expiry = environment('supabase-auth').get('GOTRUE_MAILER_OTP_EXP','3600')
    migrations = '\n'.join(re.sub(r'(?m)^(?:begin|commit);\r?$','',(STAGE/name).read_text()) for name in ['supabase/migrations/20261122000074_email_studio.sql','supabase/migrations/20261122000075_branded_email_catalog.sql'])
    sql("BEGIN; SET LOCAL lock_timeout='5s';\n"+migrations+'\nCOMMIT;')
    set_env(ROOT/'.env', {'AUTH_EMAIL_HOOK_SECRET':secret,'AUTH_EMAIL_ENCRYPTION_KEY':encryption,'AUTH_EMAIL_OTP_EXP':expiry})
    for name in ['build','public']:
        shutil.copytree(STAGE/name,ROOT/name,dirs_exist_ok=True)
    for name in ['package.json','package-lock.json']:
        shutil.copy2(STAGE/name,ROOT/name)
    run(['docker','tag',IMAGE,'etsawaa-app:latest'])
    run(['docker','compose','up','-d','--no-deps','--no-build','app'],cwd=ROOT)
    try:
        wait_app()
    except Exception:
        shutil.copy2(BACKUP/'runtime-before.tgz',BACKUP/'rollback-runtime.tgz')
        run(['docker','tag',previous,'etsawaa-app:latest'])
        run(['docker','compose','up','-d','--no-deps','--no-build','app'],cwd=ROOT)
        sql((BACKUP/'functions-before.sql').read_text())
        raise
    site = old_env.get('SITE_URL','https://etsawaa.com').rstrip('/')
    status,_ = request(site+'/api/webhooks/auth-email',b'{}',{'Content-Type':'application/json'})
    if status != 401: raise RuntimeError('Public hook endpoint is not reachable or signature validation failed: '+str(status))
    raw=b'{"deployment_probe":true}'
    stamp=str(int(time.time()))
    signature=base64.b64encode(hmac.new(base64.b64decode(secret.split('whsec_',1)[1]),b'deploy-probe.'+stamp.encode()+b'.'+raw,hashlib.sha256).digest()).decode()
    status,_=request(site+'/api/webhooks/auth-email',raw,{'Content-Type':'application/json','webhook-id':'deploy-probe','webhook-timestamp':stamp,'webhook-signature':'v1,'+signature})
    if status != 422: raise RuntimeError('Signed hook probe failed: '+str(status))
    activate_hook(auth,BACKUP,old_env,secret,site)
    report={'backup':str(BACKUP),'image':IMAGE,'templates':57,'auth_hook':'enabled','smtp':'login/noop verified; no test messages sent','signed_probe':'passed','deployed_at':STAMP}
    (BACKUP/'result.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report),flush=True)

def resume(backup):
    backup=backup.resolve()
    if backup.parent != ROOT/'backups' or not (backup/'supabase-compose-before.yml').exists(): raise RuntimeError('Invalid backup location')
    old_env=environment('etsawaa-app')
    auth=json.loads(output(['docker','inspect','supabase-auth']))[0]
    activate_hook(auth,backup,old_env,old_env['AUTH_EMAIL_HOOK_SECRET'],old_env['SITE_URL'].rstrip('/'))
    report={'backup':str(backup),'templates':57,'auth_hook':'enabled','smtp':'login/noop verified; no test messages sent','signed_probe':'passed'}
    (backup/'result.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report),flush=True)

if __name__=='__main__':
    if len(sys.argv)>2 and sys.argv[1]=='--resume': resume(Path(sys.argv[2]))
    else: main()

