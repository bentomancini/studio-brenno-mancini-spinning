import { ProtectedScreen } from '@/components/protected-screen';
import { AdminHome } from '@/components/admin-screens';
export const metadata = { title: 'Administração' };
export default function Page() { return <ProtectedScreen path="/admin" admin><AdminHome /></ProtectedScreen>; }
