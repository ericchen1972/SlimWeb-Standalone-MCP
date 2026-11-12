import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {StandaloneBackend} from '../src/backend.js';

const ok=data=>new Response(JSON.stringify({ok:true,data}),{headers:{'content-type':'application/json'}});

test('standalone bridge sends central grant and exact body binding, never self-asserted actor',async()=>{
  const calls=[];
  const backend=new StandaloneBackend({registryBaseUrl:'https://registry.example',secret:'service',lookupImpl:async()=>[{address:'93.184.216.34',family:4}],
    fetchImpl:async(url,options)=>{calls.push({url,options});return ok(calls.length===1?{origin:'https://shop.example',token:'signed-bridge'}:{saved:true});}});
  const body={name:'測試'};
  await backend.call('shop.example',{backend_grant:'central-proof',google_id:'forged',email:'other@example.test'},'settings','basic_settings','PATCH','/internal/mcp/v1/sites/swcb_site/settings/basic',body);
  const proof=JSON.parse(calls[0].options.body);
  assert.equal(proof.backend_grant,'central-proof');
  assert.equal(proof.actor,undefined);
  assert.equal(proof.domain,'shop.example');
  assert.equal(proof.body_hash,createHash('sha256').update(JSON.stringify(body)).digest('hex'));
  assert.equal(calls[1].options.body,JSON.stringify(body));
  assert.equal(calls[1].options.headers.authorization,'Bearer signed-bridge');
});

test('standalone bootstrap sends fresh Google proof and exact resource only to central registry',async()=>{
  let captured;
  const backend=new StandaloneBackend({registryBaseUrl:'https://registry.example',secret:'service',fetchImpl:async(url,options)=>{
    captured={url,options};return ok({profile:{sub:'verified',email:'owner@example.test'},backend_grant:'central-proof'});
  }});
  await backend.bootstrapIdentity({credential:'fresh-google-proof',resourceContext:'shop.example',profile:{sub:'forged'}});
  assert.equal(captured.url,'https://registry.example/internal/mcp/v1/actor-grants/bootstrap');
  assert.deepEqual(JSON.parse(captured.options.body),{credential:'fresh-google-proof',target:'standalone',domain:'shop.example'});
});
