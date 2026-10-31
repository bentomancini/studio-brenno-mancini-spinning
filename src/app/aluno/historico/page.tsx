import { ProtectedScreen } from '@/components/protected-screen';
import { Reservations } from '@/components/student-screens';
export const metadata = { title: 'Histórico' };
export default function Page() { return <ProtectedScreen path="/aluno/historico"><Reservations history /></ProtectedScreen>; }
