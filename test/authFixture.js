import {createHash} from 'node:crypto';
export function testStore() {
  const rows=new Map();
  return {async put(k,id,v,exp){if(rows.has(k+id))throw Error('exists');rows.set(k+id,{v,exp});},async get(k,id){const r=rows.get(k+id);return r?.exp>Date.now()/1000?r.v:null;},async take(k,id){const r=rows.get(k+id);rows.delete(k+id);return r?.exp>Date.now()/1000?r.v:null;}};
}
export async function accessAfterLogin(base, login) {
  const domain = new URL(login.url).searchParams.get('domain');
  const cookie = login.headers.get('set-cookie');
  const call=(path,options={})=>fetch(base+path+(path.includes('?')?'&':'?')+'domain='+encodeURIComponent(domain),{redirect:'manual',...options});
  const post=data=>({method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify(data)});
  const redirect='https://client.example/callback';
  const client=await(await call('/oauth/register',post({redirect_uris:[redirect]}))).json();
  const verifier='a'.repeat(43);
  const p=new URLSearchParams({client_id:client.client_id,redirect_uri:redirect,response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')});
  const consent=await call('/oauth/authorize?'+p,{headers:{cookie}});
  const html=await consent.text(),token=html.match(/name="consent_token" value="([^"]+)"/)?.[1];
  if(!token)throw Error('Consent failed: '+consent.status+' '+html);
  const approved=await call('/oauth/authorize',post({consent_token:token,decision:'allow'}));
  const code=new URL(approved.headers.get('location')).searchParams.get('code');
  return (await(await call('/oauth/token',post({grant_type:'authorization_code',code,client_id:client.client_id,redirect_uri:redirect,code_verifier:verifier}))).json()).access_token;
}
