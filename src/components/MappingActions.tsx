import { Check, RotateCcw, Trash2 } from "lucide-react";

export interface MappingActionsProps {
  hasUnsavedChanges: boolean;
  onApplyChanges: () => void;
  onRevertChanges: () => void;
  onRemoveMapping: () => void;
  showRemove: boolean;
}

export function MappingActions({
  hasUnsavedChanges,
  onApplyChanges,
  onRevertChanges,
  onRemoveMapping,
  showRemove,
}: MappingActionsProps) {
  return (
    <div className="mapping-actions">
      {hasUnsavedChanges && (
        <>
          <button className="btn-revert" onClick={onRevertChanges}>
            <RotateCcw size={14} /> Revert
          </button>
          <button className="btn-map" onClick={onApplyChanges}>
            <Check size={14} /> Apply
          </button>
        </>
      )}
      {showRemove && (
        <button className="btn-remove" onClick={onRemoveMapping}>
          <Trash2 size={14} /> Remove
        </button>
      )}
    </div>
  );
}
