import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useGlobalProgress } from './GlobalProgressContext';

export function GlobalProgressOverlay() {
  const { jobs } = useGlobalProgress();
  if (!jobs.length) return null;
  return <View pointerEvents="none" style={styles.host}>{jobs.slice(0,3).map((job)=><View key={job.id} style={styles.card}><View style={styles.row}><Text style={styles.label}>{job.label}</Text><Text style={styles.pct}>{Math.round(job.percent)}%</Text></View><View style={styles.track}><View style={[styles.bar,{width:`${job.percent}%`, backgroundColor: job.state==='success' ? '#16a34a' : job.state==='error' ? '#dc2626' : '#2563eb'}]} /></View><Text style={styles.message}>{job.message}</Text></View>)}</View>;
}
const styles = StyleSheet.create({ host:{ position:'absolute', top:48, right:10, left:10, gap:8, zIndex:999 }, card:{ backgroundColor:'#fff', borderRadius:10, borderWidth:1, borderColor:'#cbd5e1', padding:10 }, row:{ flexDirection:'row', justifyContent:'space-between' }, label:{ color:'#0f172a', fontSize:12, fontWeight:'700' }, pct:{ color:'#334155', fontSize:12 }, track:{ marginTop:6, height:8, backgroundColor:'#e2e8f0', borderRadius:999, overflow:'hidden' }, bar:{ height:8 }, message:{ marginTop:6, color:'#475569', fontSize:12 } });
