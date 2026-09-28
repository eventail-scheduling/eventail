import { createContext, type ReactNode, useContext, useEffect } from "react";
import type { Edition } from "#/queries/edition.js";

const LOCAL_STORAGE_KEY = "selectedEditionId";

export const readLastSelectedEditionId = (): string | null =>
    window.localStorage.getItem(LOCAL_STORAGE_KEY);

const editionContext = createContext<Edition | null>(null);

type EditionProviderProps = {
    children: ReactNode;
    edition: Edition;
};

export const EditionProvider = ({ children, edition }: EditionProviderProps): ReactNode => {
    useEffect(() => {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, edition.id);
    }, [edition.id]);

    return <editionContext.Provider value={edition}>{children}</editionContext.Provider>;
};

export const useEdition = (): Edition => {
    const edition = useContext(editionContext);

    if (edition === null) {
        throw new Error("Context used outside EditionProvider");
    }

    return edition;
};
