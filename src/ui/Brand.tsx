import React from 'react';
import {Image, ImageBackground, Pressable, Text, View} from 'react-native';
import Svg, {Path} from 'react-native-svg';

export const steel = require('../../assets/ferro.png');
export const brace = require('../../assets/brace-metal.png');
export const forge = require('../../assets/fucina.jpg');
const wordmark = require('../../assets/forgia-wordmark.png');

const shapes = {
  home: 'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  engines: 'M7 7h10v10H7z M10 10h4v4h-4z M9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4',
  access: 'M6 10h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 10V7a4 4 0 0 1 8 0v3m-4 4v2',
  method: 'M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1zm0 0v14',
  mic: 'M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zm-3 5v1a6 6 0 0 0 12 0v-1m-6 7v4m-3 0h6',
  stop: 'M6 6h12v12H6z',
  send: 'M4 12h15m-6-6 6 6-6 6',
} as const;

export type IconName = keyof typeof shapes;
export function Icon({name, color = '#e0d9cb'}: {name: IconName; color?: string}) {
  return <Svg width={23} height={23} viewBox="0 0 24 24" accessibilityElementsHidden>
    <Path d={shapes[name]} fill="none" stroke={color} strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round"/>
  </Svg>;
}

export function Wordmark() {
  return <Image source={wordmark} accessibilityLabel="Forgia" resizeMode="contain" style={{width: 192, height: 36}}/>;
}

export function NavTile({icon, title, active, onPress, mobile}: {
  icon: IconName; title: string; active: boolean; onPress: () => void; mobile: boolean
}) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{selected: active}} style={{flex: mobile ? 1 : undefined}}>
    {({pressed}) => <ImageBackground source={steel} resizeMode="cover" imageStyle={{borderRadius: 7, opacity: .6}}
      style={{flexDirection: mobile ? 'column' : 'row', alignItems: 'center', justifyContent: mobile ? 'center' : 'flex-start',
        gap: mobile ? 4 : 10, paddingHorizontal: mobile ? 1 : 12, paddingVertical: 7, borderRadius: 7,
        borderWidth: 1, borderColor: active ? '#aaa092' : 'transparent', minHeight: 48}}>
      <Icon name={icon} color={active ? '#fff0d9' : '#d0c8bb'}/>
      <Text numberOfLines={1} style={{color: '#efe6d7', fontSize: mobile ? 10 : 14, fontWeight: active ? '700' : '500'}}>{title}</Text>
      {pressed && <View pointerEvents="none" style={{position: 'absolute', bottom: 0, right: 6, width: 18, height: 2, backgroundColor: '#ffa65f'}}/>}
    </ImageBackground>}
  </Pressable>;
}
