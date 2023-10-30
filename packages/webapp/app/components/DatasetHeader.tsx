import { PropsWithChildren } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc_client";
import { Dataset } from "../lib/types";

export function DatasetHeader({
    children,
    dataset,
}: PropsWithChildren<{ dataset?: Pick<Dataset, "id" | "integrationType"> }>) {
    const navigate = useNavigate();

    const utils = trpc.useContext();

    const datasetsDelete = trpc.datasetsDelete.useMutation({
        onSettled() {
            utils.datasetsAll.invalidate();
        },
    });

    const handleDelete = async () => {
        if (dataset && confirm("Delete dataset?")) {
            await datasetsDelete.mutateAsync({ id: dataset.id });
            // TODO: Change this to be a route effect depending on (location,dataset)
            navigate("/");
        }
    };

    return (
        <div className="flex w-full items-center">
            <h1 className="text-2xl font-medium flex-1">{children}</h1>
            {dataset && dataset.integrationType === "google" && (
                <a
                    className="flex grow-0 shrink-0 gap-1 p-2 rounded hover:bg-gray-200"
                    title="Reload OAuth"
                    href={`/oauth/start/${dataset.id}`}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        className="humbleicons hi-refresh text-black w-5 h-5"
                    >
                        <path
                            xmlns="http://www.w3.org/2000/svg"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M20 20v-5h-5M4 4v5h5m10.938 2A8.001 8.001 0 005.07 8m-1.008 5a8.001 8.001 0 0014.868 3"
                        />
                    </svg>
                </a>
            )}
            {dataset && (
                <button
                    className="flex grow-0 shrink-0 gap-1 p-2 rounded hover:bg-gray-200"
                    title="Delete"
                    onClick={handleDelete}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        className="humbleicons hi-trash text-black w-5 h-5"
                    >
                        <path
                            xmlns="http://www.w3.org/2000/svg"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M6 6l.934 13.071A1 1 0 007.93 20h8.138a1 1 0 00.997-.929L18 6m-6 5v4m8-9H4m4.5 0l.544-1.632A2 2 0 0110.941 3h2.117a2 2 0 011.898 1.368L15.5 6"
                        />
                    </svg>
                </button>
            )}
        </div>
    );
}
