// Licensed local recordings use native audio, independent of sidebar visibility.
(() => {
  const selection = document.getElementById('ambientSoundSelect');
  const volume = document.getElementById('ambientVolume');
  const output = document.getElementById('ambientVolumeValue');
  const button = document.getElementById('ambientPlayButton');
  const status = document.getElementById('ambientStatus');
  const original = document.getElementById('ambientBackgroundLink');
  const key = 'pomodoro-ambient-settings-v1';
  const sounds = {
    rain: { name: 'Rain', file: 'audio/rain.mp3', youtube: 'q76bMs-NwRk' },
    fireplace: { name: 'Fireplace', file: 'audio/fireplace.wav', youtube: 'RjZvN8b_Yuk' },
    beach: { name: 'Beach', file: 'audio/beach.ogg', youtube: 'B1T06UhcX0Q' },
    jazz: { name: 'Jazz', file: 'audio/jazz.ogg', youtube: 'MYPVQccHhAQ', start: 5565 },
    cafe: { name: 'Coffee shop', file: 'audio/coffee-shop.ogg', youtube: 'uiMXGIG_DQo' },
    white: { name: 'White noise' },
  };
  let context, gain, source, noiseBuffer, audio, audioKind;
  let playing = false, generation = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && Object.hasOwn(sounds, saved.sound)) selection.value = saved.sound;
    if (saved && Number.isFinite(saved.volume)) volume.value = Math.max(0, Math.min(100, saved.volume));
  } catch (_) { /* Playback still works when storage is unavailable. */ }
  function save() {
    try { localStorage.setItem(key, JSON.stringify({ sound: selection.value, volume: Number(volume.value) })); } catch (_) {}
  }
  function updateButton() {
    button.textContent = playing ? 'Pause' : 'Play';
    button.setAttribute('aria-pressed', String(playing));
    if (navigator.mediaSession) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }
  function updateLinks() {
    const sound = sounds[selection.value];
    original.hidden = !sound.youtube;
    if (sound.youtube) original.href = `https://www.youtube.com/watch?v=${sound.youtube}${sound.start ? `&t=${sound.start}s` : ''}`;
  }
  function stopSources() {
    if (source) { source.stop(); source.disconnect(); source = null; }
    audio?.pause();
  }
  function pause() {
    generation++; playing = false;
    stopSources(); updateButton();
    status.textContent = '';
  }
  function makeWhiteNoise() {
    if (noiseBuffer) return noiseBuffer;
    const rate = 32000;
    noiseBuffer = context.createBuffer(2, rate * 16, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = noiseBuffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.23;
      const fade = rate / 20;
      for (let i = 0; i < fade; i++) { data[i] *= i / fade; data[data.length - 1 - i] *= i / fade; }
    }
    return noiseBuffer;
  }
  async function play() {
    const token = ++generation, kind = selection.value, sound = sounds[kind];
    stopSources();
    playing = true; updateButton();
    status.textContent = `Loading ${sound.name.toLowerCase()}…`;
    save();
    try {
      if (sound.file) {
        if (!audio || audioKind !== kind) {
          if (audio) { audio.removeAttribute('src'); audio.load(); }
          audio = new Audio(sound.file);
          audioKind = kind;
          audio.loop = true;
          audio.preload = 'none';
          const current = audio;
          audio.addEventListener('error', () => {
            if (audio !== current || !playing) return;
            pause();
            status.textContent = 'Could not load this sound. Press Play to retry.';
          });
        }
        audio.volume = Number(volume.value) / 100;
        await audio.play();
      } else {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) throw new Error('Audio unavailable');
        if (!context) { context = new AudioContext(); gain = context.createGain(); gain.connect(context.destination); }
        await context.resume();
        if (token !== generation || !playing) return;
        source = context.createBufferSource();
        source.buffer = makeWhiteNoise(); source.loop = true; source.connect(gain);
        gain.gain.setValueAtTime(Number(volume.value) / 100 * 0.65, context.currentTime);
        source.start();
      }
      if (token !== generation || !playing) return;
      if (window.MediaMetadata && navigator.mediaSession)
        navigator.mediaSession.metadata = new MediaMetadata({ title: sound.name, artist: 'Pomodoro Timer' });
      status.textContent = `${sound.name} is playing.`;
    } catch (_) {
      if (token !== generation) return;
      pause();
      status.textContent = 'Could not play audio. Press Play to try again.';
    }
  }
  button.addEventListener('click', () => playing ? pause() : play());
  original.addEventListener('click', pause);
  selection.addEventListener('change', () => {
    save(); updateLinks();
    if (playing) play();
    else status.textContent = '';
  });
  volume.addEventListener('input', () => {
    output.textContent = `${volume.value}%`;
    if (audio) audio.volume = Number(volume.value) / 100;
    if (gain) gain.gain.setTargetAtTime(Number(volume.value) / 100 * 0.65, context.currentTime, 0.03);
    save();
  });
  if (navigator.mediaSession) {
    for (const [action, handler] of [['play', play], ['pause', pause], ['stop', pause]]) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) {}
    }
  }
  // Hiding the drawer or changing tabs deliberately does not stop audio.
  window.addEventListener('pagehide', pause);
  output.textContent = `${volume.value}%`;
  updateLinks(); updateButton();
})();
