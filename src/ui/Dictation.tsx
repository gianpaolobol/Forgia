import React, {useEffect, useRef, useState} from 'react';
import {Platform, Pressable, Text, View} from 'react-native';
import {ExpoSpeechRecognitionModule, useSpeechRecognitionEvent} from 'expo-speech-recognition';
import {Icon} from './Brand';
import {s} from './theme';

export function Dictation({value, onChange, maxLength, disabled = false}: {
  value: string; onChange: (text: string) => void; maxLength: number; disabled?: boolean
}) {
  const prefix = useRef('');
  const pending = useRef(false);
  const owned = useRef(false);
  const mounted = useRef(true);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (owned.current) ExpoSpeechRecognitionModule.abort();
      owned.current = false;
    };
  }, []);

  useSpeechRecognitionEvent('start', () => { if (owned.current) setListening(true); });
  useSpeechRecognitionEvent('end', () => {
    if (!owned.current) return;
    owned.current = false;
    setListening(false);
  });
  useSpeechRecognitionEvent('error', event => {
    if (!owned.current || event.error === 'aborted') return;
    owned.current = false;
    setListening(false);
    setProblem('La dettatura non è riuscita. Riprova o scrivi il testo.');
  });
  useSpeechRecognitionEvent('result', event => {
    if (!owned.current || !event.isFinal) return;
    const spoken = event.results[0]?.transcript.trim();
    if (spoken) onChange([prefix.current, spoken].filter(Boolean).join(' ').slice(0, maxLength));
  });

  async function toggle() {
    if (owned.current) { ExpoSpeechRecognitionModule.stop(); return; }
    if (pending.current) return;
    pending.current = true;
    setProblem('');
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) throw Error('Dettatura non disponibile su questo dispositivo.');
      if (Platform.OS !== 'web' && !ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
        throw Error('Dettatura sul dispositivo non disponibile. Puoi usare il microfono della tastiera.');
      }
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!mounted.current) return;
      if (!permission.granted) throw Error('Per dettare, consenti l’uso del microfono nelle impostazioni.');
      prefix.current = value.trimEnd();
      owned.current = true;
      ExpoSpeechRecognitionModule.start({lang: 'it-IT', interimResults: false,
        requiresOnDeviceRecognition: Platform.OS !== 'web'});
    } catch (cause) {
      owned.current = false;
      if (mounted.current) setProblem(cause instanceof Error ? cause.message : 'Dettatura non disponibile.');
    } finally { pending.current = false; }
  }

  return <View style={{gap: 5}}>
    <Pressable accessibilityRole="button" accessibilityLabel={listening ? 'Ferma dettatura' : 'Detta con il microfono'}
      disabled={disabled && !listening} onPress={toggle} style={[s.row, {alignSelf: 'flex-start', minHeight: 44, paddingRight: 12}]}>
      <View style={{backgroundColor: '#292421', borderRadius: 7, padding: 7}}><Icon name={listening ? 'stop' : 'mic'}/></View>
      <Text style={s.label}>{listening ? 'Ferma dettatura' : 'Detta con il microfono'}</Text>
    </Pressable>
    {!!problem && <Text accessibilityRole="alert" style={s.small}>{problem}</Text>}
  </View>;
}
