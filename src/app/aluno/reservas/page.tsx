import { ProtectedScreen } from '@/components/protected-screen';
import { Reservations } from '@/components/student-screens';
export const metadata = { title: 'Minhas reservas' };
export default function Page() { return <ProtectedScreen path="/aluno/reservas"><Reservations /></ProtectedScreen>; }
