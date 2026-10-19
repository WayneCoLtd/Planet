import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {reuseSignedMedia} from '../src/media/signedUrlCache.js'
const text=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8')
const source=text.slice(text.indexOf('async function musicRequest('),text.indexOf('function formatMusicTime('))
test('stalled music reads stop waiting and expose a retryable timeout',async()=>{const timers=[];const ctx=vm.createContext({reuseSignedMedia,AbortController,setTimeout:(cb,ms)=>{timers.push(ms);return setTimeout(cb,1)},clearTimeout,fetch:async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))))});vm.runInContext(source+';globalThis.request=musicRequest',ctx);const result=await ctx.request('/api/music');assert.equal(result.ok,false);assert.match(result.error,/超时/);assert.deepEqual(timers,[20000])})
test('music writes are not automatically aborted or repeated as reads',async()=>{let calls=0;const ctx=vm.createContext({reuseSignedMedia,AbortController,setTimeout:()=>{throw Error('write timeout unexpected')},clearTimeout,fetch:async(url,options)=>{calls++;assert.equal(options.signal,undefined);return{ok:true,json:async()=>({ok:true})}}});vm.runInContext(source+';globalThis.request=musicRequest',ctx);assert.equal((await ctx.request('/api/music-requests',{method:'POST',body:'{}'})).ok,true);assert.equal(calls,1)})
