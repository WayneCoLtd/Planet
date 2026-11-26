import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {reuseSignedMedia} from '../src/media/signedUrlCache.js'
const text=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8')
const source=text.slice(text.indexOf('async function musicRequest('),text.indexOf('function formatMusicTime('))
test('stalled music reads stop waiting and expose a retryable timeout',async()=>{const timers=[];const ctx=vm.createContext({reuseSignedMedia,AbortController,setTimeout:(cb,ms)=>{timers.push(ms);return setTimeout(cb,1)},clearTimeout,fetch:async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))))});vm.runInContext(source+';globalThis.request=musicRequest',ctx);const result=await ctx.request('/api/music');assert.equal(result.ok,false);assert.match(result.error,/超时/);assert.deepEqual(timers,[20000])})
test('music writes are not automatically aborted or repeated as reads',async()=>{let calls=0;const ctx=vm.createContext({reuseSignedMedia,AbortController,setTimeout:()=>{throw Error('write timeout unexpected')},clearTimeout,fetch:async(url,options)=>{calls++;assert.equal(options.signal,undefined);return{ok:true,json:async()=>({ok:true})}}});vm.runInContext(source+';globalThis.request=musicRequest',ctx);assert.equal((await ctx.request('/api/music-requests',{method:'POST',body:'{}'})).ok,true);assert.equal(calls,1)})

test('ready playback skips signing, cold switches ignore late responses and duplicate taps cancel', async () => {
  const signed = new Map()
  const signCalls = []
  const listeners = new Map()
  const audio = {
    src: '', paused: true, addEventListener(event, listener) { listeners.set(event, listener) },
    pause() { this.paused = true }, load() { this.error = null }, removeAttribute() { this.src = '' },
    async play() { this.paused = false },
  }
  const tracks = ['ready', 'slow', 'fast'].map(id => ({
    id, hasAudio: true, playUrl: id === 'ready' ? '/ready.mp3' : '',
  }))
  const ctx = vm.createContext({
    Audio: class { constructor() { return audio } }, MUSIC_API: '/api/music',
    resolveCloudAssetUrl: url => url, toCanonicalCloudUrl: url => url, invalidateSignedMedia() {},
    musicRequest: async url => {
      if (url === '/api/music') return { ok: true, tracks, playExpiresIn: 14400 }
      const id = new URL(url, 'http://local').searchParams.get('sign')
      signCalls.push(id)
      return new Promise(resolve => signed.set(id, () => resolve({ ok: true, url: '/' + id + '.mp3', expiresIn: 14400 })))
    },
  })
  const playback = text.slice(text.indexOf('const musicState ='), text.indexOf('function musicNextId('))
  vm.runInContext(playback + ';globalThis.player = { load: musicLoadTracks, play: musicPlay }', ctx)
  await ctx.player.load()
  assert.equal(audio.src, '')
  await ctx.player.play('ready')
  assert.equal(audio.src, '/ready.mp3')
  const slow = ctx.player.play('slow')
  const fast = ctx.player.play('fast')
  signed.get('fast')()
  await fast
  signed.get('slow')()
  await slow
  assert.equal(audio.src, '/fast.mp3')
  await ctx.player.play('ready')
  assert.deepEqual(signCalls, ['slow', 'fast'])
  assert.equal(audio.src, '/ready.mp3')
  await ctx.player.play('ready')
  assert.equal(audio.paused, true)

  audio.paused = false
  audio.error = { code: 4 }
  listeners.get('error')()
  const retry = ctx.player.play('ready')
  signed.get('ready')()
  await retry
  assert.equal(audio.paused, false)
  assert.deepEqual(signCalls, ['slow', 'fast', 'ready'])
})
