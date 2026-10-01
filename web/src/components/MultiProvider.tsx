import type { ReactNode } from "react";

type ProviderCreator = (children: ReactNode) => ReactNode;

type MultiProviderProps = {
    providerCreators: ProviderCreator[];
    children: ReactNode;
};

export const MultiProvider = ({ providerCreators, children }: MultiProviderProps): ReactNode => {
    let root = children;

    for (const creator of [...providerCreators].reverse()) {
        root = creator(root);
    }

    return root;
};
