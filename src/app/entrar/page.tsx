import { AuthScreen } from '@/components/auth-screen';
export const metadata = { title: 'Entrar' };
export default async function Page({ searchParams }: { searchParams: Promise<{ returnTo?: string; result?: string }> }) { const params = await searchParams; return <AuthScreen mode="login" returnTo={params.returnTo} result={params.result} />; }
