import React from 'react';
import { ActivityIndicator, AppState, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { beginRegistrationFace, evaluateRegistrationChallenge, completeRegistrationFace } from '../services/faceVerification';
import { captureFaceImage } from '../services/cameraCapture';
import { runFaceCaptureFlow } from '../services/faceCaptureFlow';

export default function RegistrationFaceCapture({ registrationSessionId, verification, onResult }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = React.useState('ready');
  const [message, setMessage] = React.useState('');
  const [challenge, setChallenge] = React.useState(null);
  const [cameraReady, setCameraReady] = React.useState(false);
  const [pictureSize, setPictureSize] = React.useState(undefined);
  const [instruction, setInstruction] = React.useState('Position your face inside the frame');
  const camera = React.useRef(null);
  const generation = React.useRef(0);
  const busy = React.useRef(false);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (value) => {
      if (value !== 'active') { generation.current++; busy.current = false; setState('ready'); setChallenge(null); setCameraReady(false); }
    });
    return () => { mounted.current = false; generation.current++; subscription.remove(); };
  }, []);
  const active = (value) => mounted.current && generation.current === value;
  const cancel = () => { generation.current++; busy.current = false; setState('ready'); setChallenge(null); setCameraReady(false); setMessage(''); };
  const cameraOpened = async () => {
    const attempt = generation.current;
    try {
      const sizes = await camera.current.getAvailablePictureSizesAsync();
      const candidates = sizes.map((size) => ({ size, pixels: size.split('x').map(Number).reduce((a, b) => a * b, 1) })).filter((item) => Number.isFinite(item.pixels)).sort((a, b) => a.pixels - b.pixels);
      const chosen = candidates.filter((item) => item.pixels <= 1000000).pop() || candidates[0];
      if (active(attempt) && chosen) setPictureSize(chosen.size);
    } catch { /* Size enumeration is not supported by every browser camera. */ }
    if (active(attempt)) setCameraReady(true);
  };
  const start = async () => {
    if (busy.current) return;
    busy.current = true;
    const attempt = ++generation.current;
    setMessage(''); setState('opening'); setCameraReady(false);
    try {
      const granted = permission?.granted || (await requestPermission()).granted;
      if (!active(attempt)) return;
      if (!granted) throw new Error('Camera access is needed for face verification. Allow access in your device or browser settings, then try again.');
      setState('camera');
      const result = await beginRegistrationFace(registrationSessionId);
      if (!active(attempt)) return;
      if (result.faceVerification) { onResult(result.faceVerification); setState('ready'); return; }
      setChallenge(result);
      if (!result.detectorAvailable) setMessage('You can position your face, but the challenge check is not available yet. Verification cannot continue.');
    } catch (error) { if (active(attempt)) { setState('failed'); setMessage(error.message); } }
    finally { if (active(attempt)) busy.current = false; }
  };
  const perform = async () => {
    if (busy.current || !cameraReady || !challenge?.detectorAvailable) return;
    busy.current = true;
    const attempt = generation.current;
    setState('challenge');
    const assertActive = () => { if (!active(attempt)) throw new Error('Capture cancelled.'); };
    try {
      const result = await runFaceCaptureFlow({
        challenge, assertActive,
        capture: () => captureFaceImage(camera.current),
        pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        showInstruction: (text) => { assertActive(); setInstruction(text); },
        evaluate: (frames) => evaluateRegistrationChallenge(registrationSessionId, challenge.challengeId, frames),
        complete: (reference, image) => completeRegistrationFace(registrationSessionId, challenge.challengeId, reference, image),
      });
      assertActive();
      if (!result?.faceVerification) throw new Error('Face verification could not finish. Please try again.');
      onResult(result.faceVerification);
      setState(result.faceVerification.status === 'failed' ? 'failed' : 'ready');
      if (result.faceVerification.status === 'failed') setMessage("We couldn't verify your identity. Please try again.");
      setChallenge(null);
    } catch (error) { if (active(attempt)) { setState('failed'); setMessage(error.message); } }
    finally { if (active(attempt)) busy.current = false; }
  };
  if (verification.status === 'verified' && verification.duplicateCheck === 'clear' && verification.livenessPassed === true) return <View style={styles.box}><Text style={styles.title}>✓ Identity verified</Text><Text style={styles.copy}>Your face check is complete. You can continue.</Text></View>;
  if (verification.status === 'review_required') return <View style={styles.box}><Text style={styles.title}>Verification needs review</Text><Text style={styles.copy}>We found a possible existing BlueTap registration.</Text></View>;
  const cameraVisible = state === 'camera' || state === 'challenge';
  return <View style={styles.box}>
    <Text style={styles.title}>{cameraVisible ? 'Position your face inside the frame' : 'Verify your identity'}</Text>
    <Text style={styles.copy}>Complete a quick face check to help prevent duplicate accounts.</Text>
    {cameraVisible && <>
      <View style={styles.preview}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" mode="picture" mute pictureSize={pictureSize}
          onCameraReady={cameraOpened}
          onMountError={() => { generation.current++; busy.current = false; setCameraReady(false); setState('failed'); setMessage('The camera could not open. Check camera access and try again.'); }} />
        <View pointerEvents="none" style={styles.frame} />
      </View>
      <Text accessibilityLiveRegion="polite" style={styles.copy}>{state === 'challenge' ? instruction : challenge ? `Follow the instruction: ${challenge.instruction}` : 'Preparing your challenge...'}</Text>
      {state === 'challenge' ? <ActivityIndicator color="#187BCD" /> : <TouchableOpacity style={[styles.button, (!cameraReady || !challenge?.detectorAvailable) && styles.disabled]} disabled={!cameraReady || !challenge?.detectorAvailable} onPress={perform}><Text style={styles.buttonText}>Begin challenge</Text></TouchableOpacity>}
      <TouchableOpacity onPress={cancel} style={styles.secondary}><Text>Cancel</Text></TouchableOpacity>
    </>}
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.notice}>{message}</Text>}
    {!cameraVisible && <TouchableOpacity style={styles.button} disabled={state === 'opening'} onPress={start}>{state === 'opening' ? <ActivityIndicator color="#FFF" /> : <Text style={styles.buttonText}>{state === 'failed' ? 'Try Again' : 'Start Face Verification'}</Text>}</TouchableOpacity>}
    {permission?.canAskAgain === false && !permission.granted && <TouchableOpacity style={styles.secondary} onPress={() => Linking.openSettings().catch(() => setMessage('Allow camera access in your browser or device settings.'))}><Text>Open settings</Text></TouchableOpacity>}
    <Text style={styles.privacy}>Photos are used for the face check. Only verification metadata is saved in your BlueTap profile.</Text>
  </View>;
}
const styles = StyleSheet.create({
  box: { width: '100%', alignItems: 'center', gap: 16, paddingVertical: 12 },
  title: { fontSize: 23, fontWeight: '700', color: '#12304A', textAlign: 'center' },
  copy: { fontSize: 15, lineHeight: 22, color: '#4D6274', textAlign: 'center' },
  preview: { width: '100%', maxWidth: 360, aspectRatio: 3 / 4, borderRadius: 24, overflow: 'hidden', backgroundColor: '#12304A', alignItems: 'center', justifyContent: 'center' },
  frame: { width: '70%', height: '70%', borderRadius: 160, borderWidth: 3, borderColor: '#FFF' },
  button: { minHeight: 48, paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center', backgroundColor: '#187BCD', borderRadius: 12 },
  buttonText: { color: '#FFF', fontWeight: '700' }, disabled: { opacity: 0.5 },
  secondary: { padding: 12 }, notice: { color: '#9A6700', textAlign: 'center', lineHeight: 21 },
  privacy: { fontSize: 12, lineHeight: 18, color: '#64748B', textAlign: 'center' },
});
