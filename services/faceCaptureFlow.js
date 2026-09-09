// Timing spaces evidence frames only; the trusted detector decides whether the
// challenge passed. No timer or button can authorize the final capture.
async function runFaceCaptureFlow({ capture, pause, showInstruction, challenge, evaluate, complete, assertActive }) {
  if (challenge?.detectorAvailable !== true) throw new Error('The face challenge check is not available yet. Please try again later.');
  let frames = [];
  let finalImage;
  try {
    assertActive();
    showInstruction('Look straight at the camera');
    await pause(1200); assertActive(); frames.push(await capture());
    showInstruction(challenge.instruction);
    await pause(1800); assertActive(); frames.push(await capture());
    showInstruction('Look straight at the camera again');
    await pause(1200); assertActive(); frames.push(await capture());
    showInstruction('Checking your challenge...');
    const result = await evaluate(frames);
    assertActive();
    if (result?.challengePassed !== true) return result;
    showInstruction('Hold still for your final photo');
    finalImage = await capture();
    assertActive();
    showInstruction('Checking your identity...');
    return await complete(frames[2], finalImage);
  } finally {
    frames.length = 0;
    finalImage = undefined;
  }
}
module.exports = { runFaceCaptureFlow };
