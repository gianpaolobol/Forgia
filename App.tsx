import React, {useEffect, useRef} from 'react';
import {ActivityIndicator, ImageBackground, KeyboardAvoidingView, Platform, ScrollView, Text, View, useWindowDimensions} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {s, C} from './src/ui/theme';
import {NavTile, Wordmark, steel} from './src/ui/Brand';
import {Home, Editor, Detail} from './src/ui/ProjectViews';
import {Engines, Access, Method} from './src/ui/InfoViews';
import {useWorkspace} from './src/ui/useWorkspace';

const nav = [['home','Progetti'], ['engines','Motori AI'], ['access','Accessi'], ['method','Il metodo']] as const;

export default function App() {
  return <SafeAreaProvider><Workspace/></SafeAreaProvider>;
}

function Workspace() {
  const w = useWorkspace();
  const mobile = useWindowDimensions().width < 850;
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const previousPage = useRef(w.page);
  const turnCount = w.project?.turns.length ?? 0;
  useEffect(() => {
    if (w.page === 'detail') scroll.current?.scrollToEnd({animated: previousPage.current === 'detail'});
    else scroll.current?.scrollTo({y: 0, animated: false});
    previousPage.current = w.page;
  }, [w.page, w.project?.id, turnCount]);

  const navigation = nav.map(([page, label]) => <NavTile key={page} icon={page} title={label} mobile={mobile}
    active={w.page === page || (page === 'home' && (w.page === 'new' || w.page === 'detail'))} onPress={() => w.go(page)}/>);
  return <SafeAreaView style={{flex: 1, backgroundColor: '#211e1b'}}>
    <KeyboardAvoidingView style={{flex: 1}} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[s.root, s.shell]}>
        {!mobile && <ImageBackground source={steel} resizeMode="repeat" style={s.sidebar}>
          <Wordmark/>
          <View style={s.nav}>{navigation}</View>
        </ImageBackground>}
        <View style={s.main}>
          {mobile && <ImageBackground source={steel} resizeMode="repeat" style={[s.topbar, {justifyContent: 'center', paddingVertical: 10}]}>
            <Wordmark/>
          </ImageBackground>}
          <ScrollView ref={scroll} keyboardShouldPersistTaps="handled"
            contentContainerStyle={[s.page, mobile && s.mobilePage]}>
            {!!w.error && <Text accessibilityRole="alert" style={s.error}>{w.error}</Text>}
            {!w.ready && !w.error && <ActivityIndicator color={C.ink}/>}
            {w.ready && <>
              {w.page === 'home' && <Home w={w}/>}
              {w.page === 'new' && <Editor w={w}/>}
              {w.page === 'detail' && <Detail w={w}/>}
              {w.page === 'engines' && <Engines w={w} mobile={mobile}/>}
              {w.page === 'access' && <Access w={w}/>}
              {w.page === 'method' && <Method mobile={mobile}/>}
            </>}
          </ScrollView>
          {mobile && <ImageBackground source={steel} resizeMode="repeat" style={s.bottomNav}>{navigation}</ImageBackground>}
        </View>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
