import { ProtectedScreen } from '@/components/protected-screen';
import { AdminSettings } from '@/components/admin-screens';
export const metadata = { title: 'Políticas' };
export default function Page() { return <ProtectedScreen path="/admin/configuracoes" admin><AdminSettings /></ProtectedScreen>; }
