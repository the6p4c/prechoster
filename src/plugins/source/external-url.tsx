import {
    CssData,
    JavascriptData,
    ModulePlugin,
    ModulePluginProps,
    PlainTextData,
} from '../../document';
import { useMemo } from 'react';
import { SassModuleData } from './sass';

export type ExternalUrlPluginData = {
    url: string;
    type: 'javascript' | 'css' | 'scss';
};

function ExternalUrlEditor({ data, onChange }: ModulePluginProps<ExternalUrlPluginData>) {
    const urlInput = useMemo(() => Math.random().toString(36), []);
    const typeSelect = useMemo(() => Math.random().toString(36), []);

    return (
        <div className="plugin-external-url-editor">
            <div>
                <label htmlFor={urlInput}>URL</label>{' '}
                <input
                    value={data.url}
                    onChange={(e) => {
                        onChange({ ...data, url: e.target.value });
                    }}
                />
            </div>
            <div>
                <label htmlFor={typeSelect}>Type</label>{' '}
                <select
                    value={data.type}
                    onChange={(e) => {
                        onChange({ ...data, type: e.target.value as any });
                    }}
                >
                    <option value="javascript">Javascript</option>
                    <option value="css">CSS</option>
                    <option value="scss">SCSS Module</option>
                </select>
            </div>
        </div>
    );
}

const cache = new WeakMap<ExternalUrlPluginData, string>();
async function fetchCached(data: ExternalUrlPluginData): Promise<string> {
    if (cache.has(data)) {
        return cache.get(data)!;
    }

    const res = await fetch(data.url);
    if (!res.ok) {
        throw new Error(`Error loading ${data.url}: ${res.statusText}\n${await res.text()}`);
    }
    const result = await res.text();
    cache.set(data, result);
    return result;
}

export default {
    id: 'source.external-url-data',
    acceptsInputs: false,
    acceptsNamedInputs: false,
    component: ExternalUrlEditor as unknown, // typescript cant figure it out
    initialData(): ExternalUrlPluginData {
        return { url: '', type: 'javascript' };
    },
    description(data: ExternalUrlPluginData) {
        if (data.type === 'javascript') return 'Load Javascript from URL';
        if (data.type === 'css') return 'Load CSS from URL';
        if (data.type === 'scss') return 'Load SCSS Module from URL';
        return 'Load from external URL';
    },
    async eval(data: ExternalUrlPluginData) {
        const result = await fetchCached(data);
        if (data.type === 'javascript') {
            return new JavascriptData(result);
        }
        if (data.type === 'css') {
            return new CssData(result);
        }
        if (data.type === 'scss') {
            return new SassModuleData(result, 'scss');
        }
        return new PlainTextData(result);
    },
} as ModulePlugin<ExternalUrlPluginData>;
