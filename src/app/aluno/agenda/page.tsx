import { ProtectedScreen } from '@/components/protected-screen';
import { Schedule } from '@/components/student-screens';
export const metadata = { title: 'Agenda' };
export default function Page() { return <ProtectedScreen path="/aluno/agenda"><Schedule /></ProtectedScreen>; }
