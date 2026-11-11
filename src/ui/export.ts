import {Platform} from 'react-native';import {zipSync,strToU8} from 'fflate';import type {SourceBundle} from '../core/generator.ts';
export async function exportBundle(bundle:SourceBundle){
 const bytes=zipSync(Object.fromEntries(Object.entries(bundle.files).map(([path,value])=>[bundle.slug+'/'+path,strToU8(value)])));
 if(Platform.OS==='web'){const blob=new Blob([bytes as BlobPart],{type:'application/zip'}),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=bundle.slug+'-sorgenti.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);return;}
 const {File,Paths}=await import('expo-file-system');const {isAvailableAsync,shareAsync}=await import('expo-sharing');
 if(!await isAvailableAsync())throw Error('Condivisione file non disponibile.');const file=new File(Paths.cache,bundle.slug+'-sorgenti.zip');file.write(bytes);await shareAsync(file.uri,{mimeType:'application/zip',UTI:'public.zip-archive'});
}
