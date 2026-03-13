import { redirect } from 'next/navigation';

export default function DisplayPage({ params }: { params: { id: string } }) {
  redirect(`/session/${params.id}?display=1`);
}
