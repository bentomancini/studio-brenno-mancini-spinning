import { ProtectedScreen } from '@/components/protected-screen';
import { AdminCatalog } from '@/components/admin-screens';
export const metadata = { title: 'Instrutores' };
export default function Page() { return <ProtectedScreen path="/admin/instrutores" admin><AdminCatalog kind="instructors" /></ProtectedScreen>; }
