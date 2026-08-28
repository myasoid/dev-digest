CREATE TABLE "context_doc_links" (
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"path" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "context_doc_links_owner_kind_owner_id_path_pk" PRIMARY KEY("owner_kind","owner_id","path")
);
