import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {StandaloneBackend} from '../src/backend.js';
const id='99f36964-e577-4e36-a64e-a362c0b2b2f3';
test('standalone human approval uses separate registry proof and pinned exact target request',async()=>{
 const calls=[];const backend=new StandaloneBackend({registryBaseUrl:'https://registry.example',secret:'transport',lookupImpl:async()=>[{address:'8.8.8.8',family:4}],fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({ok:true,data:url.endsWith('/proof')?{origin:'https://merchant.example',token:'human-purpose-proof'}:{status:'approved'}});}});
 await backend.bootstrapHumanApproval({credential:'fresh-proof',nonce:'nonce',domain:'merchant.example',site_code:'shop',approval_id:id});
 await backend.decideHumanApproval({human_ticket:'t'.repeat(43),domain:'merchant.example',site_code:'shop',approval_id:id,decision:'approve'});
 assert.equal(JSON.parse(calls[0].options.body).target,'standalone');
 const proof=JSON.parse(calls[1].options.body);assert.equal(proof.action,'decide');assert.equal(proof.path,`/internal/human-approvals/${id}/decide`);assert.equal(proof.method,'POST');
 assert.equal(calls[2].url,`https://merchant.example${proof.path}`);assert.equal(proof.body_hash,createHash('sha256').update(calls[2].options.body).digest('hex'));
 assert.equal(calls[2].options.headers.authorization,'Bearer human-purpose-proof');assert.equal(calls[2].options.headers['X-SlimWeb-MCP-Secret'],undefined);assert.equal(calls[2].options.body.includes('tttttttt'),false);assert.equal(typeof calls[2].options.lookup,'function');
});
test('standalone human approval does not send its ticket to a rejected instance origin',async()=>{
 let customerCalls=0;const backend=new StandaloneBackend({registryBaseUrl:'https://registry.example',secret:'transport',fetchImpl:async(url)=>{if(!url.startsWith('https://registry.example'))customerCalls++;return Response.json({ok:true,data:{origin:'https://127.0.0.1',token:'proof'}});}});
 await assert.rejects(backend.previewHumanApproval({human_ticket:'t'.repeat(43),site_code:'shop',approval_id:id}),{code:'INSECURE_INSTANCE_REJECTED'});assert.equal(customerCalls,0);
});
