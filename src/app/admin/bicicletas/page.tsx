import { ProtectedScreen } from '@/components/protected-screen';
import { AdminCatalog } from '@/components/admin-screens';
export const metadata = { title: 'Bicicletas' };
export default function Page() { return <ProtectedScreen path="/admin/bicicletas" admin><AdminCatalog kind="bikes" /></ProtectedScreen>; }
