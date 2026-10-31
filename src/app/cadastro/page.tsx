import { AuthScreen } from '@/components/auth-screen';
export const metadata = { title: 'Criar conta' };
export default async function Page({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) { const params = await searchParams; return <AuthScreen mode="signup" returnTo={params.returnTo} />; }
