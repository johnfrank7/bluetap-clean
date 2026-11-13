const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Match the registration backend's existing password rule; never normalize the
// value sent to the server or expose it in feedback.
function credentialFeedback({ email = '', password = '', confirmPassword = '' }) {
  const emailValid = EMAIL.test(email.trim());
  const passwordValid = password.trim().length >= 8 && password.length <= 128;
  const confirmationMatches = confirmPassword.length > 0 && password === confirmPassword;
  return {
    emailValid,
    emailInvalid: email.length > 0 && !emailValid,
    passwordValid,
    confirmationValid: passwordValid && confirmationMatches,
    confirmationMismatch: confirmPassword.length > 0 && password !== confirmPassword,
  };
}

function registrationSessionNotice(error) {
  const code = String(error?.code || '').replace(/^registration\//, '');
  if (code === 'IP_ACCOUNT_LIMIT_REACHED') return { title: 'Network registration limit reached', message: error.message };
  if (code === 'DEVICE_ACCOUNT_LIMIT_REACHED') return { title: 'Device registration limit reached', message: error.message };
  return { title: 'Could not start registration', message: error?.message || 'Please try again.' };
}

function confirmedDuplicateEmail(reason, submittedEmail, currentEmail) {
  if (reason !== 'account-exists' || typeof submittedEmail !== 'string' || typeof currentEmail !== 'string') return '';
  const submitted = submittedEmail.trim().toLowerCase();
  return submitted && submitted === currentEmail.trim().toLowerCase() ? submitted : '';
}

module.exports = { confirmedDuplicateEmail, credentialFeedback, registrationSessionNotice };
