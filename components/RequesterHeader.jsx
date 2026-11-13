import BlueTapHeader from './BlueTapHeader';
import { useRequesterTourTarget } from './RequesterTutorialModal';

export default function RequesterHeader() {
  const notificationRef = useRequesterTourTarget('notifications');
  return (
    <BlueTapHeader
      notificationPath="/requester/r_notification"
      notificationRef={notificationRef}
    />
  );
}
