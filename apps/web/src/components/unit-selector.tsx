'use client';

import styles from './unit-selector.module.css';

interface UnitSelectorProps {
  unitIds: readonly string[];
  onSelect: (unitId: string) => void;
  disabled?: boolean;
}

export function UnitSelector({ unitIds, onSelect, disabled = false }: UnitSelectorProps) {
  return (
    <div className={styles.container}>
      <p className={styles.prompt}>Which unit is this issue for?</p>
      <div className={styles.options}>
        {unitIds.map((id) => (
          <button
            key={id}
            className={styles.unitButton}
            onClick={() => onSelect(id)}
            disabled={disabled}
          >
            {id}
          </button>
        ))}
      </div>
    </div>
  );
}
