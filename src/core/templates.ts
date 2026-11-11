export const QUIZ_SOURCE = `export function scoreQuiz(items, answers) {
 if (!items.length || items.some(i => !Object.prototype.hasOwnProperty.call(answers, i.name) || typeof answers[i.name] !== 'string' || !answers[i.name])) throw Error('Devi rispondere a tutte le domande.');
 const errors = items.filter(i => answers[i.name] !== i.color).map(i => i.name);
 return {correct: items.length - errors.length, total: items.length, errors};
}
`;
export const APP_SOURCE = `import React, {useState,useEffect} from 'react';
import {View,Text,TextInput,Pressable,ScrollView,StyleSheet} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import catalog from './src/catalog.json';
import {scoreQuiz} from './src/quiz';
type Item = {name:string;category:string;color:string};
export default function App(){return <SafeAreaProvider><Catalog /></SafeAreaProvider>}
function Catalog(){
 const [tab,setTab]=useState('catalog'),[search,setSearch]=useState(''),[category,setCategory]=useState('Tutte');
 const [favorites,setFavorites]=useState<string[]>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState('');
 const [answers,setAnswers]=useState<Record<string,string>>({}),[questions,setQuestions]=useState<Item[]>(catalog.items);
 const [result,setResult]=useState<{correct:number;total:number;errors:string[]}|null>(null),[previous,setPrevious]=useState<{correct:number;total:number}|null>(null);
 useEffect(()=>{AsyncStorage.getItem('catalog-state').then(raw=>{if(raw){const s=JSON.parse(raw);if(!Array.isArray(s.favorites)||!s.favorites.every((v:unknown)=>typeof v==='string'))throw Error('Dati non validi');setFavorites(s.favorites);if(s.previous)setPrevious(s.previous);}setLoaded(true);}).catch(()=>setError('Non riesco a leggere i salvataggi: i dati sono conservati.'));},[]);
 async function persist(next:string[],score=previous){if(!loaded)throw Error('Salvataggi non ancora disponibili');await AsyncStorage.setItem('catalog-state',JSON.stringify({favorites:next,previous:score}));}
 async function favorite(name:string){try{const next=favorites.includes(name)?favorites.filter(n=>n!==name):[...favorites,name];await persist(next);setFavorites(next);setError('');}catch{setError('Preferito non salvato. Riprova.');}}
 async function submit(){try{const r=scoreQuiz(questions,answers);await persist(favorites,r);setPrevious(r);setResult(r);setError('');}catch(e){setError(e instanceof Error?e.message:'Risultato non salvato.');}}
 const filtered=catalog.items.filter(i=>(tab!=='favorites'||favorites.includes(i.name))&&(category==='Tutte'||i.category===category)&&i.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
 const colors=Array.from(new Set(catalog.items.map(i=>i.color)));
 return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
  <Text style={s.eyebrow}>IL TUO CATALOGO · OFFLINE</Text><Text style={s.title}>{catalog.name}</Text><Text style={s.muted}>{catalog.idea}</Text>
  <View style={s.row}>{[['catalog','Catalogo'],['favorites','Preferiti'],...(catalog.quiz?[['quiz','Quiz']]:[])].map(([id,label])=><Pressable key={id} onPress={()=>setTab(id)} style={[s.chip,tab===id&&s.selected]}><Text style={tab===id?s.white:s.label}>{label}</Text></Pressable>)}</View>
  {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
  {tab!=='quiz'?<><TextInput accessibilityLabel="Cerca nel catalogo" placeholder="Cerca per nome" value={search} onChangeText={setSearch} style={s.input}/>
   <View style={s.row}>{['Tutte',...new Set(catalog.items.map(i=>i.category))].map(c=><Pressable key={c} style={[s.chip,c===category&&s.selected]} onPress={()=>setCategory(c)}><Text style={c===category?s.white:s.label}>{c}</Text></Pressable>)}</View>
   <Text style={s.muted}>{filtered.length} schede</Text>{filtered.map(i=><View key={i.name} style={s.card}><Text style={s.category}>{i.category}</Text><Text style={s.heading}>{i.name}</Text>{!!i.color&&<Text style={s.muted}>Colore: {i.color}</Text>}<Pressable accessibilityLabel={'Preferito '+i.name} disabled={!loaded} onPress={()=>favorite(i.name)} style={s.chip}><Text>{favorites.includes(i.name)?'★ Nei preferiti':'☆ Aggiungi ai preferiti'}</Text></Pressable></View>)}{!filtered.length&&<Text>Nessuna scheda trovata.</Text>}</>:
   <>{previous&&<Text style={s.muted}>Ultimo risultato: {previous.correct}/{previous.total}</Text>}{result?<View style={s.card}><Text style={s.title}>{result.correct}/{result.total}</Text><Text>{result.errors.length?'Da ripassare: '+result.errors.join(', '):'Tutte corrette.'}</Text>{questions.map(i=><Text key={i.name}>{i.name}: {i.color} · tua risposta: {answers[i.name]}</Text>)}
   {!!result.errors.length&&<Pressable style={s.button} onPress={()=>{setQuestions(catalog.items.filter(i=>result.errors.includes(i.name)));setAnswers({});setResult(null);}}><Text style={s.white}>Ripeti solo gli errori</Text></Pressable>}<Pressable style={s.chip} onPress={()=>{setQuestions(catalog.items);setAnswers({});setResult(null);}}><Text>Nuovo quiz completo</Text></Pressable></View>:
   <>{questions.map(i=>{const options=[i.color,...colors.filter(c=>c!==i.color)].slice(0,4).sort();return <View key={i.name} style={s.card}><Text style={s.heading}>Qual è il colore di {i.name}?</Text>{options.map(c=><Pressable key={c} accessibilityRole="radio" accessibilityState={{selected:answers[i.name]===c}} style={[s.chip,answers[i.name]===c&&s.selected]} onPress={()=>setAnswers({...answers,[i.name]:c})}><Text style={answers[i.name]===c?s.white:s.label}>{c}</Text></Pressable>)}</View>})}
   <Pressable accessibilityRole="button" disabled={!loaded||questions.some(i=>!answers[i.name])} style={[s.button,(!loaded||questions.some(i=>!answers[i.name]))&&{opacity:0.35}]} onPress={submit}><Text style={s.white}>Invia risposte</Text></Pressable></>}</>}
 </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:'#F6F4EF'},page:{padding:24,paddingBottom:60,width:'100%',maxWidth:760,alignSelf:'center',gap:16},title:{fontSize:36,fontWeight:'800',color:'#182E29'},eyebrow:{fontSize:11,letterSpacing:2,color:'#537167',fontWeight:'700'},muted:{fontSize:15,color:'#62716B',lineHeight:23},row:{flexDirection:'row',gap:8,flexWrap:'wrap'},chip:{padding:12,borderRadius:14,backgroundColor:'#E7EDE7'},selected:{backgroundColor:'#235C49'},label:{color:'#263E34'},white:{color:'#FFF',fontWeight:'700'},card:{backgroundColor:'#FFF',borderRadius:20,padding:22,gap:12},heading:{fontSize:23,fontWeight:'700',color:'#182E29'},category:{fontSize:12,color:'#537167'},input:{padding:16,backgroundColor:'#FFF',borderRadius:14,fontSize:16},button:{padding:18,backgroundColor:'#235C49',borderRadius:14,alignItems:'center'},error:{color:'#9C322D',backgroundColor:'#FFE6E0',padding:15,borderRadius:12}});
`;
