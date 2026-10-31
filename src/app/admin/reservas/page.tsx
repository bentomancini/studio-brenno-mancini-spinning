import { ProtectedScreen } from '@/components/protected-screen';
import { AdminReservations } from '@/components/admin-screens';
export const metadata = { title: 'Gerenciar reservas' };
export default function Page() { return <ProtectedScreen path="/admin/reservas" admin><AdminReservations /></ProtectedScreen>; }
