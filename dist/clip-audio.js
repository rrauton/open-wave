// Analysis runs in a worker; no audio is uploaded.
function analyzeAudio(samples,sr,report=()=>{}) {
  const n=4096,hop=256,re=new Float64Array(n),im=new Float64Array(n),prev=new Float64Array(n/2),chroma=new Float64Array(12),flux=[];
  let energy=0,tonalFrames=0;
  for(let pos=0;pos+n<=samples.length;pos+=hop){
    for(let i=0;i<n;i++){re[i]=samples[pos+i]*(.5-.5*Math.cos(2*Math.PI*i/(n-1)));im[i]=0;energy+=samples[pos+i]**2;}
    fft(re,im);let novelty=0;const frameChroma=new Float64Array(12);let total=0;
    for(let k=1;k<n/2-1;k++){
      const hz=k*sr/n,mag=Math.hypot(re[k],im[k]);
      if(hz<5000)novelty+=Math.max(0,Math.log1p(mag)-Math.log1p(prev[k]));prev[k]=mag;
      // Spectral peaks reduce spreading into neighboring pitch classes.
      if(hz<65||hz>2100||mag<Math.hypot(re[k-1],im[k-1])||mag<Math.hypot(re[k+1],im[k+1]))continue;
      const a=Math.log(Math.hypot(re[k-1],im[k-1])+1e-12),b=Math.log(mag+1e-12),c=Math.log(Math.hypot(re[k+1],im[k+1])+1e-12);
      const delta=Math.max(-.5,Math.min(.5,.5*(a-c)/(a-2*b+c||1)));
      const midi=69+12*Math.log2((k+delta)*sr/n/440),pc=((Math.round(midi)%12)+12)%12;
      const weight=mag*mag;frameChroma[pc]+=weight;total+=weight;
    }
    if(total>.001){tonalFrames++;for(let k=0;k<12;k++)chroma[k]+=Math.sqrt(frameChroma[k]/total);}
    flux.push(novelty);if(pos%(hop*80)===0)report(Math.round(pos/samples.length*100));
  }
  if(!flux.length||energy<1e-8)return{bpm:null,key:null,tempoConfidence:'insufficient audio',keyConfidence:'insufficient audio'};
  // Remove slowly varying loudness before comparing repeated onsets.
  const onset=flux.map((v,i)=>{let sum=0,count=0;for(let j=Math.max(0,i-8);j<=Math.min(flux.length-1,i+8);j++){sum+=flux[j];count++;}return Math.max(0,v-sum/count);});
  onset[0]=0;const fps=sr/hop,candidates=[];
  for(let lag=Math.ceil(fps*60/200);lag<=Math.floor(fps*60/60);lag++){
    let cross=0,a=0,b=0;for(let i=lag;i<onset.length;i++){cross+=onset[i]*onset[i-lag];a+=onset[i]**2;b+=onset[i-lag]**2;}
    const score=cross/Math.sqrt(a*b+1e-20);candidates.push({lag,score});
  }
  candidates.sort((a,b)=>b.score-a.score);let best=candidates[0];
  if(best){const faster=candidates.filter(c=>c.lag<best.lag*.7&&c.score>=best.score*.9&&Math.abs(best.lag/c.lag-Math.round(best.lag/c.lag))<.12).sort((a,b)=>a.lag-b.lag);if(faster.length)best=faster[0];}
  let bpm=null;
  if(best&&best.score>.15&&samples.length/sr>=4){
    // Peak interpolation improves timing resolution beyond the hop size.
    const scoreAt=l=>candidates.find(c=>c.lag===l)?.score??best.score;
    const a=scoreAt(best.lag-1),b=best.score,c=scoreAt(best.lag+1),delta=Math.max(-.5,Math.min(.5,.5*(a-c)/(a-2*b+c||1)));
    bpm=Math.max(60,Math.min(200,Math.round(60*fps/(best.lag+delta)*10)/10));
  }
  const major=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],minor=[6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
  const mean=chroma.reduce((s,x)=>s+x,0)/12,scores=[];
  for(const [mode,profile] of [['major',major],['minor',minor]])for(let root=0;root<12;root++){
    const pm=profile.reduce((s,x)=>s+x,0)/12;let dot=0,a=0,b=0;
    for(let k=0;k<12;k++){const x=chroma[k]-mean,y=profile[(k-root+12)%12]-pm;dot+=x*y;a+=x*x;b+=y*y;}
    scores.push({root,mode,score:dot/Math.sqrt(a*b+1e-20)});
  }
  scores.sort((a,b)=>b.score-a.score);const top=scores[0],gap=top.score-scores[1].score,names=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
  const key=tonalFrames>5&&top.score>.45?`${names[top.root]} ${top.mode}`:null;
  return{bpm,key,alternative:key?`${names[scores[1].root]} ${scores[1].mode}`:null,tempoConfidence:bpm?(best.score>.6?'strong pulse':'tentative'):'no stable pulse',keyConfidence:key?(gap>.12&&top.score>.7?'clear tonal match':'tentative'):'no clear key'};
}
let audioDialogClip=null,analysisWorker=null,analysisUrl=null,detectedBpm=null,analysisGeneration=0;
function cancelClipAnalysis(){analysisGeneration++;if(analysisWorker)analysisWorker.terminate();analysisWorker=null;if(analysisUrl)URL.revokeObjectURL(analysisUrl);analysisUrl=null;$('#analyzeClip').disabled=false;$('#cancelAnalysis').hidden=true;}
function openClipAudio(){const c=clips.find(c=>c.id===selectedClip);if(!c?.buffer)return toast('Select an audio clip first');closeClipContextMenu();audioDialogClip=c.id;detectedBpm=null;$('#useClipBpm').disabled=true;$('#clipAudioName').textContent=c.name;$('#clipRate').value=c.rate||1;$('#clipRateOut').textContent=(c.rate||1).toFixed(2)+'×';$('#analysisResult').textContent='Select Detect to analyze this clip.';$('#clipAudioDialog').showModal();}
function changeClipSpeed(rate){const c=clips.find(c=>c.id===audioDialogClip);if(!c)return;rate=Number(rate);if(!Number.isFinite(rate)||rate<.25||rate>2)return;cancelClipAnalysis();remember();c.duration=c.duration*(c.rate||1)/rate;c.rate=rate;detectedBpm=null;$('#useClipBpm').disabled=true;$('#analysisResult').textContent='Speed changed. Detect again for the new tempo and key.';$('#clipRate').value=rate;$('#clipRateOut').textContent=rate.toFixed(2)+'×';markDirty();render();restartAudio();toast('Clip speed updated');}
async function detectClipAudio(){
  cancelClipAnalysis();const generation=analysisGeneration;detectedBpm=null;$('#useClipBpm').disabled=true;const c=clips.find(c=>c.id===audioDialogClip);if(!c?.buffer)return;
  $('#analyzeClip').disabled=true;$('#analysisResult').textContent='Preparing audio…';
  try{
    const seconds=Math.min(90,c.duration),sr=11025;if(seconds<1)throw new Error('Use a clip at least one second long. Tempo detection needs at least four seconds.');
    const offline=new OfflineAudioContext(Math.min(2,c.buffer.numberOfChannels),Math.ceil(seconds*sr),sr),source=offline.createBufferSource();source.buffer=c.buffer;source.playbackRate.value=c.rate||1;source.connect(offline.destination);source.start(0,c.offset||0,seconds*(c.rate||1));
    const rendered=await offline.startRendering();if(generation!==analysisGeneration||!$('#clipAudioDialog').open)return;
    // Choose the louder channel, avoiding cancellation in out-of-phase stereo.
    let channel=0,highest=-1;for(let ch=0;ch<rendered.numberOfChannels;ch++){let e=0;const d=rendered.getChannelData(ch);for(let i=0;i<d.length;i+=32)e+=d[i]*d[i];if(e>highest){highest=e;channel=ch;}}
    const samples=rendered.getChannelData(channel).slice();
    analysisUrl=URL.createObjectURL(new Blob([fft.toString(),'\n',analyzeAudio.toString(),'\nonmessage=e=>{try{postMessage({result:analyzeAudio(e.data.samples,e.data.sr,p=>postMessage({progress:p}))})}catch(error){postMessage({error:error.message})}}'],{type:'text/javascript'}));
    analysisWorker=new Worker(analysisUrl);$('#cancelAnalysis').hidden=false;
    analysisWorker.onmessage=({data})=>{if(data.error){$('#analysisResult').textContent=data.error;cancelClipAnalysis();return;}if(!data.result){$('#analysisResult').textContent=`Analyzing… ${data.progress}%`;return;}
      const r=data.result;detectedBpm=r.bpm;$('#useClipBpm').disabled=!r.bpm;
      $('#analysisResult').textContent=`Tempo: ${r.bpm?r.bpm+' BPM':'undetermined'} (${r.tempoConfidence})\nKey: ${r.key||'undetermined'} (${r.keyConfidence})${r.keyConfidence==='tentative'?'\nAlternative: '+r.alternative:''}\nAnalyzed ${seconds.toFixed(1)} seconds at ${(c.rate||1).toFixed(2)}×.`;cancelClipAnalysis();};
    analysisWorker.onerror=()=>{cancelClipAnalysis();$('#analysisResult').textContent='Analysis failed. Try a shorter clip.';};analysisWorker.postMessage({samples,sr},[samples.buffer]);
  }catch(error){cancelClipAnalysis();$('#analysisResult').textContent=error.message;}
}
$('#clipAudioBtn').onclick=openClipAudio;$('#contextClipAudio').onclick=openClipAudio;
$('#clipRate').oninput=e=>$('#clipRateOut').textContent=Number(e.target.value).toFixed(2)+'×';
$('#applyClipRate').onclick=()=>changeClipSpeed($('#clipRate').value);$('#resetClipRate').onclick=()=>changeClipSpeed(1);
$('#analyzeClip').onclick=detectClipAudio;$('#cancelAnalysis').onclick=()=>{cancelClipAnalysis();$('#analysisResult').textContent='Analysis cancelled.';};
$('#closeClipAudio').onclick=()=>$('#clipAudioDialog').close();$('#clipAudioDialog').addEventListener('close',cancelClipAnalysis);
$('#useClipBpm').onclick=()=>{if(!detectedBpm)return;$('#bpm').value=detectedBpm;markDirty();restartAudio();toast('Project tempo updated');};
