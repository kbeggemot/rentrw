import AdminPortal from './portal';
import FlashToast from '@/components/admin/FlashToast';
import ActionLoader from '@/components/admin/ActionLoader';

export default function AdminPage() {
  return (
    <>
      <ActionLoader />
      <FlashToast />
      <AdminPortal />
    </>
  );
}


