import { getTokenFromDataset } from "../integration-token";
import { Integration } from "../integration-types";

export const notion: Integration = {
  name: "Notion",
  authTypes: {
    nango: {
      integrationId: "notion",
    },
  },
  authType: "token",
  authSetupDocs:
    "https://github.com/andreterron/mainframe/blob/main/packages/docs/integrations/notion.md",

  objects: {},
  tables: {
    pages: {
      name: "Pages",
      async get(dataset) {
        const token = await getTokenFromDataset(dataset);
        if (!token) {
          return null;
        }
        const res = await fetch("https://api.notion.com/v1/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `application/json`,
            "Notion-Version": `2022-06-28`,
          },
          body: JSON.stringify({
            query: "",
          }),
        });
        // TODO: Handle errors
        const rows: any = await res.json();
        return rows.results;
      },
      rowId(dataset, row) {
        return row.id;
      },
    },
  },
};
