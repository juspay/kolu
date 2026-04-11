# localci no-op forge backend — use this when you don't want CI to post
# statuses anywhere. The summary table will omit the signoff column and
# read solely from the local event stream.

repo := ""

_signoff context status description="":
    @true

_list-statuses:
    @echo "{}"

protect branch="":
    @echo "localci: no forge configured, protect is a no-op" >&2
