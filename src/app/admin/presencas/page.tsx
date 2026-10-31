import { ProtectedScreen } from '@/components/protected-screen';
import { AdminAttendance } from '@/components/admin-screens';
export const metadata = { title: 'Presenças' };
export default function Page() { return <ProtectedScreen path="/admin/presencas" admin><AdminAttendance /></ProtectedScreen>; }
