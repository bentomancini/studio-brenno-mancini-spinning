import { ProtectedScreen } from '@/components/protected-screen';
import { AdminSchedule } from '@/components/admin-screens';
export const metadata = { title: 'Criar aula' };
export default function Page() { return <ProtectedScreen path="/admin/agenda" admin><AdminSchedule create /></ProtectedScreen>; }
