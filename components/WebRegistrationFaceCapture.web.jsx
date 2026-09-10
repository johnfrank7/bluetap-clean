import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { beginRegistrationFace, completeWebRegistrationFace } from '../services/faceVerification';

const {
  WEB_CAPTURE_MAX_DATA_URL_LENGTH,
  WEB_CAPTURE_STABILITY_MS,
  browserCameraErrorMessage,
  browserCameraSupported,
  isTrustedRegistrationFaceVerification,
} = require('../services/webFaceCaptureCore');

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const waitForPaint = () => new Promise((resolve) => {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(resolve);
  else setTimeout(resolve, 0);
});

function stopMediaStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function captureJpeg(video) {
  if (!video?.videoWidth || !video?.videoHeight) throw new Error('The camera preview is not ready. Please try again.');

  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const largestSide = Math.max(sourceWidth, sourceHeight);
  let targetSize = Math.min(640, largestSide);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const scale = targetSize / largestSide;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The camera image could not be prepared. Please try again.');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/jpeg', attempt === 0 ? 0.8 : 0.68);
    canvas.width = 0;
    canvas.height = 0;
    if (image.length <= WEB_CAPTURE_MAX_DATA_URL_LENGTH) return image;
    targetSize = Math.max(360, Math.round(targetSize * 0.75));
  }

  throw new Error('The camera image is too large. Move closer to the camera and try again.');
}

export default function WebRegistrationFaceCapture({ registrationSessionId, verification, onResult }) {
  const videoRef = React.useRef(null);
  const streamRef = React.useRef(null);
  const mounted = React.useRef(true);
  const attemptRef = React.useRef(0);
  const busy = React.useRef(false);
  const [state, setState] = React.useState('ready');
  const [message, setMessage] = React.useState('');
  const [cameraVisible, setCameraVisible] = React.useState(false);
  const [readyAt, setReadyAt] = React.useState(0);
  const [clock, setClock] = React.useState(Date.now());
  const [challenge, setChallenge] = React.useState(null);

  const stopCamera = React.useCallback((hide = true) => {
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (hide && mounted.current) setCameraVisible(false);
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attemptRef.current += 1;
      stopCamera(false);
    };
  }, [stopCamera]);

  React.useEffect(() => {
    if (!readyAt || state !== 'camera') return undefined;
    const timer = setInterval(() => setClock(Date.now()), 100);
    return () => clearInterval(timer);
  }, [readyAt, state]);

  const stable = readyAt > 0 && clock - readyAt >= WEB_CAPTURE_STABILITY_MS;
  const active = (attempt) => mounted.current && attemptRef.current === attempt;

  const reset = () => {
    attemptRef.current += 1;
    busy.current = false;
    stopCamera();
    setState('ready');
    setChallenge(null);
    setReadyAt(0);
    setMessage('');
  };

  const start = async () => {
    if (busy.current) return;
    if (!browserCameraSupported(globalThis.navigator)) {
      setState('failed');
      setMessage('This browser does not support camera access. Use a current browser with an available camera.');
      return;
    }

    busy.current = true;
    const attempt = ++attemptRef.current;
    setState('opening');
    setMessage('');
    setChallenge(null);
    setReadyAt(0);
    setCameraVisible(true);

    try {
      await waitForPaint();
      const stream = await globalThis.navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 640 },
          height: { ideal: 640 },
        },
      });
      if (!active(attempt)) {
        stopMediaStream(stream);
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('The camera preview could not start. Please try again.');
      video.srcObject = stream;
      await video.play();
      if (!active(attempt)) return;

      const result = await beginRegistrationFace(registrationSessionId);
      if (!active(attempt)) return;
      if (result?.faceVerification) {
        onResult(result.faceVerification);
        stopCamera();
        setState('ready');
        return;
      }
      if (!result?.challengeId) throw new Error('The face verification service returned an incomplete response. Please try again.');

      setChallenge(result);
      setReadyAt(Date.now());
      setClock(Date.now());
      setState('camera');
    } catch (error) {
      if (!active(attempt)) return;
      stopCamera();
      setState('failed');
      const cameraError = ['NotAllowedError', 'PermissionDeniedError', 'NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError', 'SecurityError'].includes(error?.name);
      setMessage(cameraError ? browserCameraErrorMessage(error) : error?.message || 'The camera could not start. Please try again.');
    } finally {
      if (active(attempt)) busy.current = false;
    }
  };

  const capture = async () => {
    if (busy.current || !challenge?.challengeId || !stable) return;
    busy.current = true;
    const attempt = attemptRef.current;
    setState('capturing');
    setMessage('Hold still while we capture a clear image...');
    let referenceImage;
    let image;

    try {
      referenceImage = captureJpeg(videoRef.current);
      await pause(700);
      if (!active(attempt)) return;
      image = captureJpeg(videoRef.current);
      stopCamera();
      setState('processing');
      setMessage('Checking your identity...');
      const result = await completeWebRegistrationFace(registrationSessionId, challenge.challengeId, referenceImage, image);
      if (!active(attempt) || !result?.faceVerification) return;
      onResult(result.faceVerification);
      if (!isTrustedRegistrationFaceVerification(result.faceVerification)) {
        setState('failed');
        setMessage(result.faceVerification.duplicateCheck === 'flagged'
          ? 'This face may already be associated with an existing BlueTap account.'
          : "We couldn't verify your face. Please try again.");
      } else {
        setState('ready');
        setMessage('Identity check completed.');
      }
    } catch (error) {
      if (!active(attempt)) return;
      setState('failed');
      const code = String(error?.code || '');
      setMessage(code.includes('registration-session-expired')
        ? 'Your registration session expired. Go back and restart identity verification.'
        : code.includes('face-review-required')
          ? 'This face may already be associated with an existing BlueTap account.'
          : error?.message || "We couldn't verify your face. Please try again.");
    } finally {
      referenceImage = undefined;
      image = undefined;
      if (active(attempt)) busy.current = false;
    }
  };

  if (isTrustedRegistrationFaceVerification(verification)) {
    return <View style={styles.stack}><View style={[styles.box, styles.successPanel]}><Text style={styles.successMark}>OK</Text><Text style={styles.title}>Identity check completed</Text><Text style={styles.copy}>Your face verification was confirmed by BlueTap.</Text></View><PrivacyNote /></View>;
  }

  if (verification.status === 'review_required') {
    return <View style={styles.stack}><View style={[styles.box, styles.reviewPanel]}><Text style={styles.warningMark}>!</Text><Text style={styles.title}>Verification needs review</Text><Text style={styles.copy}>This face may already be associated with an existing BlueTap account.</Text></View><PrivacyNote /></View>;
  }

  const showPreview = cameraVisible && state !== 'failed';
  return <View style={styles.stack}><View style={[styles.box, state === 'failed' && styles.failedPanel]}>
    <Text style={styles.title}>{showPreview ? 'Position your face inside the frame' : state === 'failed' ? 'Verification unsuccessful' : 'Verify your identity'}</Text>
    <Text style={styles.copy}>{showPreview ? 'Look directly at the camera and keep only one face in the oval.' : 'Complete a quick face check to help protect your account and prevent duplicate registrations.'}</Text>

    {showPreview && <View style={styles.preview}>
      <video ref={videoRef} autoPlay muted playsInline aria-label="BlueTap face verification camera preview" style={videoStyle} />
      <View pointerEvents="none" style={[styles.frame, state === 'processing' && styles.frameProgress]} />
    </View>}

    {showPreview && state === 'camera' && <Text accessibilityLiveRegion="polite" style={styles.guidance}>{stable ? 'Hold still, then capture your face.' : 'Hold still while we prepare a clear capture...'}</Text>}
    {state === 'processing' && <View style={styles.processing}><ActivityIndicator color="#187BCD" /><Text style={styles.processingText}>Checking your identity...</Text></View>}
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.notice}>{message}</Text>}

    {state === 'camera' && <TouchableOpacity style={[styles.button, !stable && styles.disabled]} disabled={!stable} onPress={capture}><Text style={styles.buttonText}>Capture face</Text></TouchableOpacity>}
    {showPreview && state !== 'processing' && <TouchableOpacity style={styles.secondary} onPress={reset}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>}
    {!showPreview && <TouchableOpacity style={styles.button} disabled={state === 'opening'} onPress={start}>{state === 'opening' ? <View style={styles.processing}><ActivityIndicator color="#FFF" /><Text style={styles.buttonText}>Opening camera...</Text></View> : <Text style={styles.buttonText}>{state === 'failed' ? 'Try again' : 'Start camera check'}</Text>}</TouchableOpacity>}
  </View><PrivacyNote /></View>;
}

function PrivacyNote() {
  return <View style={styles.privacyBox}><View style={styles.privacyContent}><Text style={styles.privacyTitle}>Privacy and security</Text><Text style={styles.privacy}>BlueTap sends your captures to its verification service for this check. BlueTap stores verification metadata in your profile, not the captured image.</Text></View></View>;
}

const videoStyle = {
  width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', backgroundColor: '#12304A',
};

const styles = StyleSheet.create({
  stack: { width: '100%', gap: 16 },
  box: { width: '100%', alignItems: 'center', gap: 12, padding: 24, backgroundColor: '#F8FBFE', borderWidth: 1, borderColor: '#DDEBF6', borderRadius: 18 },
  title: { fontSize: 19, fontWeight: '600', color: '#12304A', textAlign: 'center' },
  copy: { fontSize: 15, lineHeight: 22, color: '#4D6274', textAlign: 'center' },
  preview: { width: '100%', maxWidth: 360, aspectRatio: 3 / 4, borderRadius: 16, overflow: 'hidden', backgroundColor: '#12304A', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  frame: { position: 'absolute', width: '67%', height: '72%', borderRadius: 180, borderWidth: 3, borderColor: '#FFF' },
  frameProgress: { borderColor: '#71D6B0' },
  guidance: { fontSize: 14, lineHeight: 20, color: '#315F82', textAlign: 'center' },
  button: { width: '100%', minHeight: 50, paddingHorizontal: 16, paddingVertical: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: '#187BCD', borderRadius: 11, marginTop: 4 },
  buttonText: { color: '#FFF', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.5 },
  secondary: { padding: 12 }, secondaryText: { color: '#416581', fontSize: 14 },
  processing: { flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }, processingText: { color: '#315F82', fontSize: 14 },
  notice: { color: '#8D6024', backgroundColor: '#FFF7E8', padding: 12, borderRadius: 10, fontSize: 14, textAlign: 'center', lineHeight: 21, width: '100%' },
  successPanel: { backgroundColor: '#F4FBF7', borderColor: '#D7EDE0' }, reviewPanel: { backgroundColor: '#FFFCF5', borderColor: '#F0E5C9' }, failedPanel: { borderColor: '#EDDCCF' },
  successMark: { color: '#238254', fontSize: 27, fontWeight: '700' }, warningMark: { color: '#9A6525', fontSize: 25, fontWeight: '600' },
  privacyBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#EFF6FC', borderRadius: 12, padding: 16 },
  privacyContent: { flex: 1 }, privacyTitle: { color: '#2E536F', fontSize: 14, fontWeight: '600', marginBottom: 4 }, privacy: { fontSize: 13, lineHeight: 20, color: '#526E84' },
});
