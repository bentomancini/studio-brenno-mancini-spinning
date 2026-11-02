import { SkeletonScreen } from '@/components/ui';
import styles from '@/components/studio.module.css';

export default function Pending() {
  return (
    <main id="conteudo" className={styles.adminMain} style={{ minHeight: '80vh' }}>
      <SkeletonScreen />
    </main>
  );
}
