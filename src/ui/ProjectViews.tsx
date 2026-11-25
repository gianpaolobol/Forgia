import React, {useState} from 'react';
import {Image, Pressable, Text, View} from 'react-native';
import {forge} from './Brand';
import {Dictation} from './Dictation';
import {Button, Field, Tag} from './parts';
import {s} from './theme';
import type {Workspace} from './useWorkspace';

export function Home({w}: {w: Workspace}) {
  return <>
    <Image source={forge} accessibilityLabel="Un fabbro lavora il ferro sull’incudine"
      style={{width: '100%', height: 290, borderRadius: 12}} resizeMode="cover"/>
    <Text style={s.hero}>Dai forma alla tua app</Text>
    <Button disabled={!w.ready || w.busy} onPress={w.start}>Crea un progetto</Button>
    <Text style={s.title}>I tuoi progetti</Text>
    {w.projects.map(project => <Pressable key={project.id} style={s.card} onPress={() => w.open(project.id)}
      accessibilityRole="button" accessibilityLabel={`Apri ${project.name}`}>
      <Text style={s.heading}>{project.name}</Text>
      <Text numberOfLines={2} style={s.body}>{project.turns[0].text}</Text>
    </Pressable>)}
  </>;
}

export function Editor({w}: {w: Workspace}) {
  return <>
    <Text style={s.hero}>Nuova idea</Text>
    <View style={s.card}>
      <Field label="Nome della tua app" value={w.name} onChangeText={w.setName} maxLength={80} placeholder="Es. Erbario"/>
      <Field label="Descrivi la tua idea" value={w.idea} onChangeText={w.setIdea} multiline maxLength={4000}
        placeholder="Che app vuoi creare?"/>
      <Dictation value={w.idea} onChange={w.setIdea} maxLength={4000} disabled={w.busy}/>
      <Button disabled={w.busy || !w.name.trim() || !w.idea.trim()} onPress={w.create}>Avvia la chat</Button>
    </View>
  </>;
}

export function Detail({w}: {w: Workspace}) {
  const [preview, setPreview] = useState(false);
  if (!w.project) return null;
  const project = w.project;
  const access = w.access.filter(item => item.projectId === project.id);
  return <>
    <View style={s.between}>
      <Text style={s.hero}>{project.name}</Text>
      {!!access.length && <Button secondary onPress={() => w.go('access')}>Accessi richiesti</Button>}
    </View>
    {project.turns.map((turn, index) => <View key={index} style={[s.card, {alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start',
      width: '90%', backgroundColor: turn.role === 'user' ? '#e8d2b5' : '#f5e8d4'}]}>
      <Text style={s.label}>{turn.role === 'user' ? 'Tu' : turn.model || 'Forgia'}</Text>
      <Text selectable style={s.body}>{turn.text}</Text>
    </View>)}
    {!w.liveAI && <Text style={s.small}>L’AI è disponibile nel pannello web locale. I messaggi scritti qui restano su questo dispositivo.</Text>}
    {!!w.jobStatus && <Tag>{w.jobStatus}</Tag>}
    {w.liveAI && project.turns.at(-1)?.role === 'user' && !w.busy &&
      <Button secondary onPress={w.retry}>Riprova con l’AI</Button>}
    {project.spec?.kind === 'catalog' && <>
      <View style={s.card}>
        <Pressable accessibilityRole="button" accessibilityState={{expanded: preview}}
          onPress={() => setPreview(open => !open)} style={s.between}>
          <Text style={s.heading}>Anteprima catalogo</Text>
          <Tag>{project.spec.items.length} schede</Tag>
        </Pressable>
        {preview && project.spec.items.map(item => <View key={item.name}>
          <Text style={s.label}>{item.name}</Text>
          <Text style={s.body}>{item.category}{item.color ? ' · ' + item.color : ''}</Text>
        </View>)}
      </View>
      <Button secondary onPress={w.download}>Esporta sorgenti ZIP</Button>
    </>}
    <View style={s.card}>
      <Field label="Messaggio" placeholder="Descrivi il prossimo passo" value={w.note} onChangeText={w.setNote}
        multiline maxLength={4000}/>
      <View style={s.between}>
        <Dictation value={w.note} onChange={w.setNote} maxLength={4000} disabled={w.busy}/>
        <Button disabled={w.busy || !w.note.trim()} onPress={w.send}>Invia</Button>
      </View>
    </View>
  </>;
}
