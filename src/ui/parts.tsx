import React from 'react';import {Image,Text,Pressable,View,TextInput,type TextInputProps} from 'react-native';import {s,C} from './theme';
import {brace} from './Brand';
export function Button({children,onPress,secondary=false,disabled=false,label}:{
 children:React.ReactNode;onPress:()=>void;secondary?:boolean;disabled?:boolean;label?:string
}){
 return <Pressable accessibilityRole="button" accessibilityLabel={label??(typeof children==='string'?children:undefined)}
  accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
  style={[s.button,secondary&&s.secondary,disabled&&{opacity:0.4}]}>
  {({pressed})=><>
   <Image source={brace} resizeMode="stretch" style={{position:'absolute',top:1,left:1,bottom:1,right:1,
     width:undefined,height:undefined,borderRadius:10,opacity:secondary ? .48 : .72}}/>
   <Text style={secondary?s.secondaryText:s.buttonText}>{children}</Text>
   {pressed&&<View pointerEvents="none" style={s.ember}/>}
  </>}
 </Pressable>;
}
export function Tag({children}:{children:React.ReactNode}){return <View style={s.tag}><Text style={s.tagText}>{children}</Text></View>}
export function Field({label,...props}:TextInputProps&{label:string}){return <View><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor="#756659" {...props} style={[s.input,props.multiline&&s.textarea,props.style]}/></View>}
export function Step({n,title,children}:{n:string;title:string;children:React.ReactNode}){return <View style={s.step}><View style={s.circle}><Text style={{color:C.ink,fontWeight:'800'}}>{n}</Text></View><View style={s.stepCopy}><Text style={s.heading}>{title}</Text><Text style={s.body}>{children}</Text></View></View>}
