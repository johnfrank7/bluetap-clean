import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';

import { getModuleSession, getRoleLoginPath, signOutAndClearSessions } from '../services/authSession';
import { getSessionPolicy } from '../services/sessionSecurity';

const WARNING_MS = 60 * 1000;
export default function SessionSecurityGuard({ children, role }) {
  const router = useRouter();
  const idleTimer = React.useRef(null);
  const warningTimer = React.useRef(null);
  const absoluteTimer = React.useRef(null);
  const policyRef = React.useRef(null);
  const expiredRef = React.useRef(false);
  const [warning, setWarning] = React.useState(false);

  const clearTimers = React.useCallback(() => {
    clearTimeout(idleTimer.current);
    clearTimeout(warningTimer.current);
    clearTimeout(absoluteTimer.current);
  }, []);

  const expire = React.useCallback(async () => {
    if (expiredRef.current) return;
    expiredRef.current = true;
    clearTimers();
    await signOutAndClearSessions();
    router.replace(getRoleLoginPath(role));
  }, [clearTimers, role, router]);

  const scheduleIdle = React.useCallback(() => {
    const policy = policyRef.current;
    if (!policy || expiredRef.current) return;
    clearTimeout(idleTimer.current);
    clearTimeout(warningTimer.current);
    setWarning(false);
    const idleMs = policy.idleTimeoutMinutes * 60 * 1000;
    warningTimer.current = setTimeout(() => setWarning(true), Math.max(idleMs - WARNING_MS, 0));
    idleTimer.current = setTimeout(expire, idleMs);
  }, [expire]);

  React.useEffect(() => {
    if (!['requester', 'distributor', 'manager'].includes(role)) return undefined;
    let active = true;
    getSessionPolicy(role).then((policy) => {
      if (!active || !policy) return;
      policyRef.current = policy;
      scheduleIdle();
      const session = getModuleSession(role);
      const startedAt = Number(session?.createdAt || session?.updatedAt || Date.now());
      absoluteTimer.current = setTimeout(expire, Math.max(0, startedAt + policy.absoluteSessionHours * 60 * 60 * 1000 - Date.now()));
    });
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((event) => globalThis.addEventListener?.(event, scheduleIdle, { passive: true }));
    return () => {
      active = false;
      clearTimers();
      events.forEach((event) => globalThis.removeEventListener?.(event, scheduleIdle));
    };
  }, [clearTimers, expire, role, scheduleIdle]);

  if (!['requester', 'distributor', 'manager'].includes(role)) return children;
  return <View style={styles.root} onTouchStart={scheduleIdle}>{children}<Modal visible={warning} transparent animationType="fade" onRequestClose={scheduleIdle}><View style={styles.backdrop}><View style={styles.card}><Text style={styles.title}>Your session is about to expire</Text><Text style={styles.body}>For your security, BlueTap will sign you out after one minute of inactivity.</Text><View style={styles.actions}><TouchableOpacity onPress={expire} style={styles.secondary}><Text style={styles.secondaryText}>Sign out now</Text></TouchableOpacity><TouchableOpacity onPress={scheduleIdle} style={styles.primary}><Text style={styles.primaryText}>Stay signed in</Text></TouchableOpacity></View></View></View></Modal></View>;
}

const styles = StyleSheet.create({ root:{flex:1},backdrop:{flex:1,backgroundColor:'rgba(2,10,18,.72)',alignItems:'center',justifyContent:'center',padding:20},card:{width:'100%',maxWidth:430,backgroundColor:'#FFFFFF',borderRadius:18,padding:22},title:{color:'#12304A',fontSize:20,fontWeight:'900'},body:{color:'#64748B',fontSize:14,lineHeight:21,marginTop:8},actions:{flexDirection:'row',justifyContent:'flex-end',gap:10,marginTop:22},secondary:{minHeight:44,borderWidth:1,borderColor:'#D7ECFF',borderRadius:10,paddingHorizontal:16,justifyContent:'center'},secondaryText:{color:'#12304A',fontWeight:'800'},primary:{minHeight:44,borderRadius:10,paddingHorizontal:16,justifyContent:'center',backgroundColor:'#187BCD'},primaryText:{color:'#FFFFFF',fontWeight:'900'} });
