import {validateSpec,slug} from './spec.ts';
import {APP_SOURCE,QUIZ_SOURCE} from './templates.ts';
export interface SourceBundle {files:Record<string,string>;stage:'source_generated';pending:string[];slug:string}
const json=(v:unknown)=>JSON.stringify(v,null,2)+'\n';
export function generateProject(input:unknown):SourceBundle {
 const spec=validateSpec(input);if(spec.kind!=='catalog')throw Error('Generazione non supportata per questa famiglia: occorre il backend reale.');
 const id=slug(spec.name);
 return {slug:id,stage:'source_generated',pending:['dependency_install','native_build','physical_install','store_distribution'],files:{
  'package.json':json({name:id,version:'0.1.0',private:true,main:'index.ts',scripts:{start:'expo start',web:'expo start --web',check:'tsc --noEmit'},dependencies:{expo:'58.0.23',react:'19.3.0','react-native':'0.88.1','react-dom':'19.3.0','react-native-web':'~0.21.4','@react-native-async-storage/async-storage':'2.2.0','react-native-safe-area-context':'~5.11.1'},devDependencies:{typescript:'5.9.3','@types/react':'19.2.2'}}),
  'app.json':json({expo:{name:spec.name,slug:id,version:'0.1.0',orientation:'portrait',ios:{supportsTablet:true},android:{},web:{output:'single'}}}),
  'index.ts':"import {registerRootComponent} from 'expo';\nimport App from './App';\nregisterRootComponent(App);\n",
  'App.tsx':APP_SOURCE,'src/catalog.json':json(spec),'src/quiz.js':QUIZ_SOURCE,
  'src/quiz.d.ts':'export function scoreQuiz(items: {name:string;color:string}[], answers: Record<string,string>): {correct:number;total:number;errors:string[]};\n',
  'tsconfig.json':json({extends:'expo/tsconfig.base',compilerOptions:{strict:true}}),
  '.gitignore':'node_modules/\n.expo/\ndist/\n.env*\n',
  'README.md':`# ${spec.name}\n\nSorgenti generati da Forgia tramite modello di catalogo offline. Non è una beta firmata o collaudata su dispositivo. Nessuna AI o API necessaria in questa app generata.\n\n1. npm install\n2. npx expo install --check\n3. npm run check\n4. npm start\n\nPrima della distribuzione impostare identificativi univoci, creare un lockfile con le dipendenze verificate, compilare e provare installazione pulita, salvataggi, rete assente e accessibilità su iOS e Android. I dati locali si perdono disinstallando l'app. Il quiz riguarda solo i colori forniti. Le risposte del ripasso sostituiscono l'ultimo risultato; non modificano i dati del catalogo.\n`
 }};
}
