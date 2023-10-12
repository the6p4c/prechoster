import { useMemo } from 'react';
import { DirPopover } from '../../uikit/dir-popover';
import { ModuleDef, CATEGORIES, MODULES } from '../../plugins';
import { ModulePlugin, JsonValue } from '../../document';
import './module-picker.less';

export function ModulePicker({ open, anchor, onClose, onPick }: ModulePicker.Props) {
    return (
        <DirPopover open={open} onClose={onClose} anchor={anchor}>
            <div className="module-picker-items">
                {Object.keys(CATEGORIES).map((categoryId) => (
                    <Category key={categoryId} categoryId={categoryId} onPick={onPick} />
                ))}
            </div>
        </DirPopover>
    );
}
namespace ModulePicker {
    export interface Props {
        open: boolean;
        anchor?: HTMLElement | [number, number] | null;
        onClose: () => void;
        onPick: (m: ModulePlugin<JsonValue>) => void;
    }
}

function Category({
    categoryId,
    onPick,
}: {
    categoryId: string;
    onPick: (m: ModulePlugin<JsonValue>) => void;
}) {
    return (
        <>
            <div className="module-picker-item module-picker-category">
                <strong>{CATEGORIES[categoryId].title}</strong>
            </div>
            {Object.keys(MODULES)
                .filter((moduleId) => {
                    return MODULES[moduleId].categoryId === categoryId;
                })
                .map((moduleId) => (
                    <Module
                        key={moduleId}
                        module={MODULES[moduleId]}
                        onPick={async () => {
                            onPick(await MODULES[moduleId].load());
                        }}
                    />
                ))}
        </>
    );
}

function Module({ module, onPick }: { module: ModuleDef; onPick: () => void }) {
    const [titleId] = useMemo(() => Math.random().toString(36), []);

    return (
        <div className="module-picker-item module-picker-module" aria-labelledby={titleId}>
            <div className="i-details">
                <h3 id={titleId}>{module.title}</h3>
                <p>{module.description}</p>
            </div>
            <button
                className="i-add-button"
                onClick={onPick}
                aria-label={`Select ${module.title}`}
            />
        </div>
    );
}
