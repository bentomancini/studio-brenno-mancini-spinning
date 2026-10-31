import { ProtectedScreen } from '@/components/protected-screen';
import { StudentHome } from '@/components/student-screens';
export const metadata = { title: 'Seu Studio' };
export default function Page() { return <ProtectedScreen path="/aluno"><StudentHome /></ProtectedScreen>; }
