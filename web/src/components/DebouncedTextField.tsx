import { TextField, type TextFieldProps } from "@mui/material";
import { debounce } from "@mui/material/utils";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Long enough to outlast a word, short enough that the list keeps up. */
const DEFAULT_DELAY_MS = 300;

type DebouncedTextFieldProps = Omit<
    TextFieldProps,
    "value" | "onChange" | "onBlur" | "onKeyDown" | "defaultValue"
> & {
    value: string | undefined;

    /** Given the trimmed text, or undefined once the box is empty. */
    onCommit: (value: string | undefined) => void;

    delay?: number;
};

/**
 * A text field that commits on its own while the reader types.
 *
 * A box that only answers to Return reads as broken to anyone who does not press
 * it, and one that commits per keystroke asks for a request per keystroke. This
 * waits out a pause, and treats Return and leaving the box as "now" rather than
 * "shortly", canceling whatever was queued.
 *
 * The text being edited is held here while `value` stays what was committed, so
 * the two can differ mid-word. A `value` arriving from outside, a back step or
 * an in-app link, replaces it; one that is this box's own commit coming back
 * does not, or every character typed during the round trip would be lost when
 * it lands.
 */
export const DebouncedTextField = ({
    value,
    onCommit,
    delay = DEFAULT_DELAY_MS,
    ...textFieldProps
}: DebouncedTextFieldProps): ReactNode => {
    const [text, setText] = useState(value ?? "");
    // What this box has committed and not yet seen come back. The router
    // publishes a search param only once the navigation commits, which is after
    // the list's loader has fetched, so an arriving value is as likely to be
    // this box's own commit as somebody else's change, and only the second may
    // replace what is being typed. A queue rather than one value, since a
    // second commit can be made while the first is still traveling.
    const inFlight = useRef<(string | undefined)[]>([]);
    // The callback and the committed value are read through refs so the
    // debounce below can be built once. Rebuilt on a new callback identity, it
    // would cancel whatever is queued every time the parent re-renders, which
    // is exactly what the commit landing makes it do.
    const onCommitRef = useRef(onCommit);
    const valueRef = useRef(value);

    useEffect(() => {
        onCommitRef.current = onCommit;
        valueRef.current = value;
    });

    useEffect(() => {
        const index = inFlight.current.indexOf(value);

        if (index !== -1) {
            inFlight.current = inFlight.current.slice(index + 1);
            return;
        }

        inFlight.current = [];
        setText(value ?? "");
    }, [value]);

    const commit = useCallback((next: string | undefined) => {
        const outstanding = inFlight.current;
        const current =
            outstanding.length > 0 ? outstanding[outstanding.length - 1] : valueRef.current;

        if (next === current) {
            return;
        }

        inFlight.current = [...outstanding, next];
        onCommitRef.current(next);
    }, []);

    // Debounced at the keystroke rather than off the text above, so the effect
    // that mirrors `value` into it cannot feed itself.
    const commitLater = useMemo(() => debounce(commit, delay), [commit, delay]);

    useEffect(
        () => () => {
            commitLater.clear();
        },
        [commitLater],
    );

    const commitNow = (next: string) => {
        commitLater.clear();
        commit(next.trim() === "" ? undefined : next.trim());
    };

    return (
        <TextField
            {...textFieldProps}
            value={text}
            onChange={(event) => {
                const next = event.target.value;
                setText(next);
                commitLater(next.trim() === "" ? undefined : next.trim());
            }}
            onBlur={() => {
                commitNow(text);
            }}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    commitNow(text);
                }
            }}
        />
    );
};
