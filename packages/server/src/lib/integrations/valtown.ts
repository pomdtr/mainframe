import { getTokenFromDataset } from "../integration-token";
import { Integration } from "../integration-types";
import { Dataset } from "@mainframe-so/shared";

export const valtown: Integration = {
  name: "Val Town",
  authType: "token",
  authSetupDocs: "https://docs.val.town/api/authentication/",
  objects: {
    currentUser: {
      name: "Current User",
      get: async (dataset: Dataset) => {
        const token = await getTokenFromDataset(dataset);
        if (!token) return null;
        return getCurrentUser(token);
      },
      objId: (dataset: Dataset, obj) => {
        return obj.id;
      },
    },
  },
  tables: {
    vals: {
      name: "Vals",
      get: async (dataset: Dataset) => {
        const token = await getTokenFromDataset(dataset);
        if (!token) return [];
        const user = await getCurrentUser(token);
        const res = await fetch(
          `https://api.val.town/v1/users/${user.id}/vals`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );
        return (await res.json()).data;
      },
      rowId(dataset, row) {
        return `${row.id}`;
      },
    },
  },
};

async function getCurrentUser(token: string) {
  const res = await fetch("https://api.val.town/v1/me", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return res.json();
}
