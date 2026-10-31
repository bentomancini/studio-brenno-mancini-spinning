import { ProtectedScreen } from '@/components/protected-screen';
import { AdminSchedule } from '@/components/admin-screens';
export const metadata = { title: 'Gerenciar agenda' };
export default function Page() { return <ProtectedScreen path="/admin/agenda" admin><AdminSchedule /></ProtectedScreen>; }
